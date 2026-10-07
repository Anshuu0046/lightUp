import { type Clip, projectDuration, type Project, type Track, uid } from './model'
import { mixAudio } from './exporter'
import { BASE_TEXT, TEXT_TEMPLATES, type TextSpec } from './text'

export type CaptionLanguage = 'en' | 'hi' | 'te'
export const LANGUAGES: { id: CaptionLanguage; label: string; whisper: string }[] = [
  { id: 'en', label: 'English', whisper: 'english' },
  { id: 'hi', label: 'हिन्दी Hindi', whisper: 'hindi' },
  { id: 'te', label: 'తెలుగు Telugu', whisper: 'telugu' },
]
export const MODELS = {
  fast: { id: 'onnx-community/whisper-base', label: 'Fast', size: '~100 MB' },
  accurate: { id: 'onnx-community/whisper-small', label: 'Accurate', size: '~250–400 MB' },
}
export type CaptionOptions = { language: CaptionLanguage; quality: keyof typeof MODELS; skipMusic: boolean; words: number; style: string }

export const CAPTION_TRACK: Track = { id: 'captions', kind: 'visual', name: 'Captions', muted: false, hidden: false }

type Chunk = { text: string; timestamp: [number, number | null] }
export type Progress = { stage: 'audio' | 'download' | 'listening'; share?: number; mb?: number }

let worker: Worker | null = null

const audible = (a: Float32Array) => a.some(v => Math.abs(v) > 0.003)
async function speechAudio(p: Project, duration: number) {
  const mixed = await mixAudio(p, duration)
  const off = new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000)
  const node = off.createBufferSource(); node.buffer = mixed; node.connect(off.destination); node.start()
  return (await off.startRendering()).getChannelData(0)
}

/** Mixes the timeline's sound to 16 kHz mono (what Whisper hears) and transcribes it on this device */
export async function transcribe(p: Project, o: CaptionOptions, onProgress: (p: Progress) => void): Promise<Chunk[]> {
  const duration = projectDuration(p)
  if (!duration) throw new Error('Add a clip with speech first.')
  onProgress({ stage: 'audio' })
  // music confuses speech recognition, so it's left out, unless the speech itself is sitting on the Music track
  let audio = await speechAudio(o.skipMusic ? { ...p, tracks: p.tracks.map(t => (t.id === 'a1' ? { ...t, muted: true } : t)) } : p, duration)
  if (!audible(audio) && o.skipMusic) audio = await speechAudio(p, duration)
  if (!audible(audio)) throw new Error('There’s no sound on the timeline to caption.')

  worker ??= new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ type: string; share?: number; mb?: number; chunks?: Chunk[]; message?: string }>) => {
      const m = e.data
      if (m.type === 'download') onProgress({ stage: 'download', share: m.share, mb: m.mb })
      else if (m.type === 'listening') onProgress({ stage: 'listening' })
      else if (m.type === 'done') resolve(m.chunks!)
      else if (m.type === 'error') reject(new Error(m.message?.includes('fetch') ? 'Couldn’t download the speech model. Check your internet connection and try again.' : m.message))
    }
    w.onerror = () => reject(new Error('Captions stopped unexpectedly. Try the Fast model.'))
    const lang = LANGUAGES.find(l => l.id === o.language)!.whisper
    w.postMessage({ audio, language: lang, model: MODELS[o.quality].id }, [audio.buffer])
  })
}

/**
 * Turns Whisper's sentences into short on-screen captions, a few words at a time,
 * sharing each sentence's time across its words by length (longer words stay up longer).
 */
export function captionClips(chunks: Chunk[], o: Pick<CaptionOptions, 'words' | 'style'>, end: number): Clip[] {
  const template = TEXT_TEMPLATES.find(t => t.id === o.style) ?? TEXT_TEMPLATES[1]
  const spec: TextSpec = { ...BASE_TEXT, ...template.spec, width: 0.86, animOut: 'none' }
  const clips: Clip[] = []
  chunks.forEach((c, i) => {
    const text = c.text.replace(/\s+/g, ' ').trim()
    if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) return // skip "[Music]" and similar
    const start = c.timestamp[0]
    const stop = Math.min(c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? end, end)
    if (stop - start < 0.05) return
    const words = text.split(' ')
    const weight = words.map(w => w.length + 1)
    const total = weight.reduce((a, b) => a + b, 0)
    for (let k = 0, at = start; k < words.length; k += o.words) {
      const group = words.slice(k, k + o.words)
      const share = weight.slice(k, k + o.words).reduce((a, b) => a + b, 0) / total
      const len = (stop - start) * share
      clips.push({ id: uid(), assetId: 'text', trackId: CAPTION_TRACK.id, start: at, in: 0, out: Math.max(0.15, len - 0.01), speed: 1, volume: 0, opacity: 1, transform: { x: 0.5, y: 0.78, scale: 1, rotation: 0 }, text: { ...spec, content: group.join(' ') } })
      at += len
    }
  })
  return clips
}

/** Applies a caption style to every caption, keeping each one's words */
export function restyle(p: Project, style: string): Clip[] {
  const template = TEXT_TEMPLATES.find(t => t.id === style) ?? TEXT_TEMPLATES[1]
  return p.clips.filter(c => c.trackId === CAPTION_TRACK.id && c.text).map(c => ({ ...c, text: { ...BASE_TEXT, ...template.spec, width: 0.86, animOut: 'none', content: c.text!.content } }))
}
