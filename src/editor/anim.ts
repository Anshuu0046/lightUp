/** Animated GIF / WebP / APNG support: decode every frame once, then pick the right one for any moment. */

// WebCodecs ImageDecoder (Chromium); declared here because not every TypeScript lib ships it yet
type DecodedFrame = { image: VideoFrame }
type ImageDecoderLike = { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; animated: boolean } | null }; decode(o: { frameIndex: number }): Promise<DecodedFrame>; close(): void }
const Decoder = (globalThis as unknown as { ImageDecoder?: new (o: { data: ReadableStream | ArrayBuffer; type: string }) => ImageDecoderLike }).ImageDecoder

export type Animation = { frames: ImageBitmap[]; ends: number[]; total: number; width: number; height: number }
const MAX_FRAMES = 240
const cache = new Map<string, Promise<Animation | null>>()
const done = new Map<string, Animation | null>()

const ANIMATABLE = /^image\/(gif|webp|png|apng)$/

/** How many frames a file has (0 if it isn't animated or can't be read) */
export async function frameCount(f: Blob): Promise<{ frames: number; seconds: number }> {
  if (!Decoder || !ANIMATABLE.test(f.type)) return { frames: 0, seconds: 0 }
  try {
    const anim = await decodeAll(f)
    return anim ? { frames: anim.frames.length, seconds: anim.total } : { frames: 0, seconds: 0 }
  } catch { return { frames: 0, seconds: 0 } }
}

async function decodeAll(f: Blob): Promise<Animation | null> {
  if (!Decoder) return null
  const d = new Decoder({ data: await f.arrayBuffer(), type: f.type })
  try {
    await d.tracks.ready
    const track = d.tracks.selectedTrack
    if (!track || !track.animated || track.frameCount < 2) return null
    const frames: ImageBitmap[] = [], ends: number[] = []
    let t = 0
    for (let i = 0; i < Math.min(track.frameCount, MAX_FRAMES); i++) {
      const { image } = await d.decode({ frameIndex: i })
      t += Math.max(0.02, (image.duration ?? 100000) / 1e6) // microseconds; GIFs with no delay play at 10 fps
      frames.push(await createImageBitmap(image)); ends.push(t)
      image.close()
    }
    return { frames, ends, total: t, width: frames[0].width, height: frames[0].height }
  } finally { d.close() }
}

/** Starts decoding an asset's frames (once); `onReady` runs when they are available */
export function loadAnimation(id: string, file: Blob, onReady?: () => void) {
  if (!cache.has(id)) cache.set(id, decodeAll(file).then(a => { done.set(id, a); onReady?.(); return a }).catch(() => { done.set(id, null); return null }))
  return cache.get(id)!
}

/** The frame showing `local` seconds into a looping animation, or null until it's decoded */
export function frameAt(id: string, local: number): ImageBitmap | null {
  const a = done.get(id)
  if (!a) return null
  const t = ((local % a.total) + a.total) % a.total
  let lo = 0, hi = a.ends.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a.ends[mid] <= t) lo = mid + 1; else hi = mid }
  return a.frames[lo]
}
