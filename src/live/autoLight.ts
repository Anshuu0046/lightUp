import type { Face } from '../faceTracker'
import type { Style } from './rig'

/** What the controller wants applied to the rig on top of the user's own settings */
export type Correction = { gain: number; whiten: number }
export const NEUTRAL: Correction = { gain: 1, whiten: 0 }

const SIZE = 24
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Sample = { y: number; r: number; g: number; b: number; clipped: number }

/** Mean brightness, mean colour and share of blown-out pixels in a 24x24 look at the face */
function sample(ctx: CanvasRenderingContext2D, src: CanvasImageSource, box: [number, number, number, number]): Sample {
  ctx.drawImage(src, box[0], box[1], box[2], box[3], 0, 0, SIZE, SIZE)
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data
  let r = 0, g = 0, b = 0, clipped = 0
  const n = SIZE * SIZE
  for (let i = 0; i < px.length; i += 4) {
    r += px[i]; g += px[i + 1]; b += px[i + 2]
    if (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] > 247) clipped++
  }
  r /= n * 255; g /= n * 255; b /= n * 255
  return { y: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b, clipped: clipped / n }
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
      // the cheeks, nose and forehead: the centre of the face, away from hair, beard and background
      const halfW = face.w * 0.2, halfH = (face.w * video.videoWidth * 1.3 / video.videoHeight) * 0.2
      const box = (w: number, h: number): [number, number, number, number] => [clamp(face.x - halfW, 0, 1 - 2 * halfW) * w, clamp(face.y - halfH, 0, 1 - 2 * halfH) * h, 2 * halfW * w, 2 * halfH * h]
      try {
        const lit_ = sample(this.ctx, lit, box(lit.width, lit.height))
        const cam = sample(this.camCtx, video, box(video.videoWidth, video.videoHeight))
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
    const target = style === 'bulb' ? 0.5 : (style === 'ring' ? 0.58 : 0.5) + (brightness - 55) * 0.0035
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
