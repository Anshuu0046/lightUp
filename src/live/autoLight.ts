import type { Face } from '../faceTracker'
import type { Style } from './rig'

/** What the controller wants applied to the rig on top of the user's own settings */
export type Correction = { gain: number; whiten: number }
export const NEUTRAL: Correction = { gain: 1, whiten: 0 }

const SIZE = 24
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Sample = { y: number; r: number; g: number; b: number; clipped: number }
type Box = [number, number, number, number]

/**
 * Brightness and colour of the skin in a small look at the face. Skin is picked from the unlit camera picture
 * (warm, mid-bright pixels), so a beard, eyebrows or hair don't drag the reading down; the median ignores stray highlights.
 */
function measure(litCtx: CanvasRenderingContext2D, camCtx: CanvasRenderingContext2D, lit: CanvasImageSource, cam: CanvasImageSource, litBox: Box, camBox: Box): { lit: Sample; cam: Sample } {
  litCtx.drawImage(lit, ...litBox, 0, 0, SIZE, SIZE)
  camCtx.drawImage(cam, ...camBox, 0, 0, SIZE, SIZE)
  const L = litCtx.getImageData(0, 0, SIZE, SIZE).data, C = camCtx.getImageData(0, 0, SIZE, SIZE).data
  const luma = (d: Uint8ClampedArray, i: number) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
  let picks: number[] = []
  for (let i = 0; i < C.length; i += 4) {
    const r = C[i], g = C[i + 1], b = C[i + 2], y = luma(C, i)
    if (r > g && g >= b * 0.85 && r - b > 14 && y > 0.16 && y < 0.97) picks.push(i)
  }
  // not enough skin found (unusual light, or the face is mostly covered): use the middle of the brightness range
  if (picks.length < SIZE * SIZE * 0.12) {
    const all = Array.from({ length: SIZE * SIZE }, (_, k) => k * 4).sort((a, b) => luma(C, a) - luma(C, b))
    picks = all.slice(Math.floor(all.length * 0.3), Math.floor(all.length * 0.9))
  }
  const read = (d: Uint8ClampedArray): Sample => {
    const ys = picks.map(i => luma(d, i)).sort((a, b) => a - b)
    let r = 0, g = 0, b = 0, clipped = 0
    for (const i of picks) { r += d[i]; g += d[i + 1]; b += d[i + 2]; if (luma(d, i) > 0.97) clipped++ }
    const n = picks.length * 255
    return { y: ys[Math.floor(ys.length / 2)], r: r / n, g: g / n, b: b / n, clipped: clipped / picks.length }
  }
  return { lit: read(L), cam: read(C) }
}

/**
 * Keeps the lit face in a flattering range for any skin tone and room, without ever pumping:
 *  - exposure: nudges light strength so the face's brightness lands on a target (slowly, so it never visibly breathes)
 *  - highlights: backs off if the skin starts to clip to white
 *  - skin colour: if the light pushes skin's colour too far from the camera's own, mixes it toward white
 * Bulb mode is a deliberate mood, so it only guards against blow-outs.
 */
export class AutoLight {
  private probe = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private cam = document.createElement('canvas')
  private camCtx: CanvasRenderingContext2D
  private frame = 0
  private out: Correction = { ...NEUTRAL }
  private want: Correction = { ...NEUTRAL }
  /** Last measurements, for tests and debugging */
  last: { lit: Sample; cam: Sample } | undefined

  constructor() {
    this.probe.width = this.probe.height = this.cam.width = this.cam.height = SIZE
    this.ctx = this.probe.getContext('2d', { willReadFrequently: true })!
    this.camCtx = this.cam.getContext('2d', { willReadFrequently: true })!
  }

  /** Call right after the lit frame has been drawn (the GPU canvas is only readable until the frame is presented) */
  update(lit: HTMLCanvasElement, video: HTMLVideoElement, face: Face | undefined, style: Style, brightness: number, active = true): Correction {
    if (style === 'natural' || !face) {
      this.want = { ...NEUTRAL }
    } else if (++this.frame % 4 === 0) {
      // forehead and upper cheeks: the skin a ring light lands on, above any beard
      const halfW = face.w * 0.27, faceH = face.w * video.videoWidth * 1.3 / video.videoHeight
      const top = clamp(face.y - faceH * 0.34, 0, 1), bottom = clamp(face.y + faceH * 0.04, 0, 1)
      const box = (w: number, h: number): Box => [clamp(face.x - halfW, 0, 1 - 2 * halfW) * w, top * h, 2 * halfW * w, Math.max(1, (bottom - top) * h)]
      try {
        const { lit: lit_, cam } = measure(this.ctx, this.camCtx, lit, video, box(lit.width, lit.height), box(video.videoWidth, video.videoHeight))
        this.last = { lit: lit_, cam }
        this.want = active ? this.decide(lit_, cam, style, brightness) : { ...NEUTRAL }
      } catch { this.want = { ...NEUTRAL } }
    }
    // move a small step toward what's wanted every frame: a second or so to settle, never a jump
    // brighten slowly so it never breathes, but back off quickly when the room gets brighter so skin doesn't blow out
    this.out.gain += (this.want.gain - this.out.gain) * (this.want.gain < this.out.gain ? 0.12 : 0.04)
    this.out.whiten += (this.want.whiten - this.out.whiten) * 0.04
    return this.out
  }

  private decide(lit: Sample, cam: Sample, style: Style, brightness: number): Correction {
    // the user's brightness slider still matters: it moves the target, it doesn't fight the controller
    // skin, not the whole face: a flattering exposure for skin sits a little above the middle
    const target = style === 'bulb' ? 0.55 : (style === 'ring' ? 0.62 : 0.55) + (brightness - 55) * 0.0035
    let gain = this.out.gain // relative to what is applied now, so slow smoothing can never wind the correction up
    // the light is applied on top of ambient, so a modest exponent converges without overshoot
    gain *= Math.pow(target / Math.max(lit.y, 0.04), 0.45)
    if (lit.clipped > 0.06) gain *= 1 - Math.min(0.12, lit.clipped * 0.4)
    gain = style === 'bulb' ? clamp(gain, 0.4, 1) : clamp(gain, 0.12, 5)
    // only act on ring and window; a bulb's colour is the point of it
    let whiten = 0
    if (style !== 'bulb') {
      const chroma = (s: Sample) => [s.r / Math.max(s.y, 0.02), s.b / Math.max(s.y, 0.02)]
      const [lr, lb] = chroma(lit), [cr, cb] = chroma(cam)
      const drift = Math.abs(lr - cr) + Math.abs(lb - cb)
      whiten = clamp((drift - 0.28) * 1.6, 0, 0.55)
    }
    return { gain, whiten }
  }
}
