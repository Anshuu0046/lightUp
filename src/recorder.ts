import { release, watch } from './capture'

/** Composites the lit picture (or the plain camera without WebGPU) and the catchlights into one canvas, for recording, photos and the virtual camera. */
export function compositor(stage: HTMLElement) {
  const pick = () => stage.querySelector('.depth-canvas.active') as HTMLCanvasElement | null
  const video = stage.querySelector('video')
  const overlay = stage.querySelector('.ring-overlay') as HTMLCanvasElement | null
  const out = document.createElement('canvas'), g = out.getContext('2d')!
  let watched: HTMLCanvasElement | null = null
  const draw = () => {
    const live = pick()
    if (!live) {
      if (!video?.videoWidth) return false
      if (out.width !== video.videoWidth) { out.width = video.videoWidth; out.height = video.videoHeight }
      g.drawImage(video, 0, 0)
      if (overlay?.width) g.drawImage(overlay, 0, 0, out.width, out.height)
      return true
    }
    if (live !== watched) { if (watched) release(watched); watched = live }
    const src = watch(live)
    if (!src?.width) return false
    if (out.width !== src.width || out.height !== src.height) { out.width = src.width; out.height = src.height }
    g.drawImage(src, 0, 0)
    if (overlay?.width) g.drawImage(overlay, 0, 0, out.width, out.height)
    return true
  }
  return { out, draw, done: () => watched && release(watched) }
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
function save(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

/** The first draw only starts the copying, so give the renderer a moment to produce a frame */
async function firstFrame(c: ReturnType<typeof compositor>) {
  for (let i = 0; i < 20; i++) { if (c.draw()) return true; await new Promise(r => setTimeout(r, 50)) }
  return false
}

export async function takePhoto(stage: HTMLElement) {
  const c = compositor(stage)
  if (!await firstFrame(c)) { c.done(); throw new Error('Wait for the camera to finish loading.') }
  c.draw()
  c.done()
  c.out.toBlob(b => b && save(b, `light-up-${stamp()}.png`), 'image/png')
}

const MIMES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

/** Starts recording the lit stage (with the mic if it can be opened). Resolves with stop(), which saves the file. */
export async function startRecording(stage: HTMLElement) {
  if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser.')
  const mime = MIMES.find(m => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('No supported video format in this browser.')
  const c = compositor(stage)
  if (!await firstFrame(c)) { c.done(); throw new Error('Wait for the camera to finish loading.') }
  let mic: MediaStream | undefined
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }) } catch { /* record without sound */ }
  const stream = c.out.captureStream(30)
  mic?.getAudioTracks().forEach(t => stream.addTrack(t))
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = e => e.data.size && chunks.push(e.data)
  let frame = 0
  const pump = () => { c.draw(); frame = requestAnimationFrame(pump) }
  pump(); rec.start(1000)
  return {
    hasAudio: !!mic?.getAudioTracks().length,
    stop: () => new Promise<void>(done => {
      rec.onstop = () => {
        cancelAnimationFrame(frame); c.done(); stream.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop())
        save(new Blob(chunks, { type: mime.split(';')[0] }), `light-up-${stamp()}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`); done()
      }
      rec.stop()
    }),
  }
}
