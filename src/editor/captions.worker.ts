/// <reference lib="webworker" />
// Speech-to-text (and translation) off the main thread, so the editor stays responsive while Whisper listens.
import { env, pipeline, Tensor } from '@huggingface/transformers'

env.allowLocalModels = false
// the runtime files are bundled with the app, so there's nothing to cache (and app:// can't be cached anyway)
;(env as { useWasmCache?: boolean }).useWasmCache = false
// the speech runtime ships with the app instead of loading from a CDN
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
if (ort.wasm) ort.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' }

type Lang = 'en' | 'hi' | 'te'
type Request = { audio: Float32Array; spoken: Lang | 'auto'; target: Lang; model: string; heavyOk: boolean }
type Chunk = { text: string; timestamp: [number, number | null] }
type Asr = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: Chunk[] }>) & {
  processor: (audio: Float32Array) => Promise<{ input_features: Tensor }>
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>) & { generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> } }
}
type Translator = (texts: string[], opts: Record<string, unknown>) => Promise<{ translation_text: string }[]>

const WHISPER: Record<Lang, string> = { en: 'english', hi: 'hindi', te: 'telugu' }
const NLLB: Record<Lang, string> = { en: 'eng_Latn', hi: 'hin_Deva', te: 'tel_Telu' }
/**
 * Measured on real Hindi and Telugu speech: only the large model writes Telugu correctly (the small ones loop on garbage),
 * but the large model can't tell Telugu from Tamil, while the base model picks the right language reliably.
 * So the base model listens for the language, and Hindi and Telugu are always written by the large one.
 */
const DETECTOR = 'onnx-community/whisper-base'
const INDIAN = 'onnx-community/whisper-large-v3-turbo'
/** Translation model, downloaded only when captions are wanted in a language other than the one spoken */
const TRANSLATOR = 'Xenova/nllb-200-distilled-600M'

const loaded = new Map<string, Promise<unknown>>()

/** Frees a model's memory. Hindi/Telugu with translation needs ~1.5 GB if two models stay loaded, which freezes phones, so only one lives at a time */
async function release(model: string) {
  const p = loaded.get(model)
  loaded.delete(model)
  try { await (await p as { dispose?: () => Promise<void> } | undefined)?.dispose?.() } catch { /* already gone */ }
}

/** Reports download progress across all of a model's files as one bar */
function progress(stage: 'download' | 'download-translator') {
  const files = new Map<string, { loaded: number; total: number }>()
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
    let a = 0, b = 0
    for (const f of files.values()) { a += f.loaded; b += f.total }
    postMessage({ type: stage, share: b ? a / b : 0, mb: Math.round(b / 1e6) })
  }
}

async function gpu() {
  const adapter = 'gpu' in navigator ? await (navigator as unknown as { gpu: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu.requestAdapter().catch(() => null) : null
  return adapter ? { f16: adapter.features.has('shader-f16') } : null
}

function loadAsr(model: string) {
  if (!loaded.has(model)) loaded.set(model, (async () => {
    const g = await gpu()
    const big = model.includes('large')
    // the large model's encoder is 2.5 GB at full precision; 4-bit keeps it near 400 MB with little loss
    const opts = g
      ? { device: 'webgpu', dtype: { encoder_model: big ? (g.f16 ? 'q4f16' : 'q4') : model.includes('small') ? 'fp16' : 'fp32', decoder_model_merged: big && g.f16 ? 'q4f16' : 'q4' } }
      : { device: 'wasm', dtype: 'q8' }
    return pipeline('automatic-speech-recognition', model, { ...opts, progress_callback: progress('download') } as never)
  })().catch(e => { loaded.delete(model); throw e }))
  return loaded.get(model) as Promise<Asr>
}

function loadTranslator() {
  if (!loaded.has(TRANSLATOR)) loaded.set(TRANSLATOR, pipeline('translation', TRANSLATOR, { device: 'wasm', dtype: 'q8', progress_callback: progress('download-translator') } as never)
    .catch(e => { loaded.delete(TRANSLATOR); throw e }))
  return loaded.get(TRANSLATOR) as Promise<Translator>
}

/**
 * Which of our languages is being spoken. Whisper's first decoding step scores every language;
 * only English, Hindi and Telugu are compared (Hindi is otherwise often mistaken for Urdu, which sounds the same).
 * Listens to the loudest 30 seconds, which are most likely speech.
 */
async function detect(asr: Asr, audio: Float32Array): Promise<Lang> {
  const SR = 16000, span = 30 * SR
  let from = 0
  if (audio.length > span) {
    let best = -1
    for (let s = 0; s + span <= audio.length; s += 5 * SR) {
      let e = 0
      for (let i = s; i < s + span; i += 64) e += audio[i] * audio[i]
      if (e > best) { best = e; from = s }
    }
  }
  const { input_features } = await asr.processor(audio.subarray(from, from + span))
  const config = asr.model.generation_config
  const start = new Tensor('int64', BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1])
  const { logits } = await asr.model({ input_features, decoder_input_ids: start })
  const scores = (logits.type === 'float32' ? logits : logits.to('float32')).data as Float32Array
  const vocab = logits.dims[logits.dims.length - 1], row = scores.subarray(scores.length - vocab)
  return (Object.keys(WHISPER) as Lang[]).reduce((a, b) => (row[config.lang_to_id[`<|${b}|>`]] > row[config.lang_to_id[`<|${a}|>`]] ? b : a))
}

/**
 * Keeps the translation and drops what the model adds after it: text up to the sentence end that covers about
 * the source's length, and (for Hindi and Telugu) nothing after it drifts into English.
 */
function tidy(text: string, target: Lang, sourceLength: number) {
  let t = text.trim()
  const ends = [...t.matchAll(/[.!?।॥]+/g)].map(m => m.index! + m[0].length)
  const enough = ends.find(e => e >= sourceLength * 0.5)
  if (enough) t = t.slice(0, enough)
  if (target !== 'en') { const latin = t.search(/[A-Za-z]{3,}/); if (latin > 0) t = t.slice(0, latin) }
  return t.trim()
}

// some runtime failures surface as stray rejections; report them instead of leaving the dialog waiting
self.addEventListener('unhandledrejection', e => postMessage({ type: 'error', message: e.reason instanceof Error ? e.reason.message : String(e.reason) }))

self.onmessage = async (e: MessageEvent<Request>) => {
  const { audio, spoken, target, model, heavyOk } = e.data
  try {
    postMessage({ type: 'listening' })
    let language: Lang
    if (spoken === 'auto') { language = await detect(await loadAsr(DETECTOR), audio); if (!heavyOk && language !== 'en') await release(DETECTOR) }
    else language = spoken
    postMessage({ type: 'detected', language })
    if (!heavyOk && language !== 'en') throw new Error('Hindi and Telugu captions need more memory than this device has. Use a laptop or desktop, or caption English speech here.')
    if (!heavyOk && language !== target) throw new Error('Translating captions needs more memory than this device has. Use a laptop or desktop.')
    const wanted = language === 'en' ? model : INDIAN
    if (loaded.has(DETECTOR) && wanted !== DETECTOR) await release(DETECTOR)
    const asr = await loadAsr(wanted)
    postMessage({ type: 'listening' })
    const out = await asr(audio, { language: WHISPER[language], task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
    let chunks = (out.chunks ?? [{ text: out.text, timestamp: [0, audio.length / 16000] }]).filter(c => c.text.trim())
    if (language !== target && chunks.length) {
      await release(wanted) // the speech model is done: free it before the translator loads
      const translate = await loadTranslator()
      postMessage({ type: 'translating' })
      const done: Chunk[] = []
      for (const c of chunks) {
        // one line at a time, with a length budget: left to run, the model keeps inventing text after the translation
        const text = c.text.trim()
        const [out] = await translate([text], { src_lang: NLLB[language], tgt_lang: NLLB[target], max_new_tokens: Math.ceil(text.length * 0.8) + 12, num_beams: 1, repetition_penalty: 1.15, no_repeat_ngram_size: 3 })
        done.push({ ...c, text: tidy(out?.translation_text ?? text, target, text.length) })
      }
      chunks = done
      await release(TRANSLATOR)
    }
    postMessage({ type: 'done', chunks, language })
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
