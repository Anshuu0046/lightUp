/// <reference lib="webworker" />
// Speech-to-text off the main thread, so the editor stays responsive while Whisper listens.
import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false
// the speech runtime ships with the app instead of loading from a CDN
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
if (ort.wasm) ort.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' }

type Request = { audio: Float32Array; language: string; model: string }
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>

let asr: Asr | null = null
let loaded = ''

async function load(model: string) {
  if (asr && loaded === model) return asr
  const gpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null))
  const files = new Map<string, { loaded: number; total: number }>()
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
    let a = 0, b = 0
    for (const f of files.values()) { a += f.loaded; b += f.total }
    postMessage({ type: 'download', share: b ? a / b : 0, mb: Math.round(b / 1e6) })
  }
  const opts = gpu
    ? { device: 'webgpu', dtype: { encoder_model: model.includes('small') ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }, progress_callback: progress }
    : { device: 'wasm', dtype: 'q8', progress_callback: progress }
  asr = (await pipeline('automatic-speech-recognition', model, opts as never)) as unknown as Asr
  loaded = model
  return asr
}

// some runtime failures surface as stray rejections; report them instead of leaving the dialog waiting
self.addEventListener('unhandledrejection', e => postMessage({ type: 'error', message: e.reason instanceof Error ? e.reason.message : String(e.reason) }))

self.onmessage = async (e: MessageEvent<Request>) => {
  const { audio, language, model } = e.data
  try {
    const run = await load(model)
    postMessage({ type: 'listening' })
    const out = await run(audio, { language, task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
    postMessage({ type: 'done', chunks: out.chunks ?? [{ text: out.text, timestamp: [0, audio.length / 16000] }] })
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
