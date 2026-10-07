import { type Hue, hueColor, lightColor } from '../live/rig'
import { loadSegmenter, personMask } from './segment'

/**
 * Studio lighting added to a filmed clip. key: the focus light on you (0 = off), placed at x, y (0-1 of the clip),
 * small and hard (soft 0) to big and soft (100). room: how much of the original light stays (100 = as filmed).
 * back: a coloured lamp behind you, its brightness and where it stands (backSide 0 left, 100 right).
 */
export type Lighting = { key: number; keyHue: Hue | 'white'; warmth: number; x: number; y: number; soft: number; room: number; back: Hue | 'off'; backLevel: number; backSide: number }
export const DEFAULT_LIGHTING: Lighting = { key: 55, keyHue: 'white', warmth: 4500, x: 0.32, y: 0.3, soft: 55, room: 70, back: 'off', backLevel: 60, backSide: 75 }

type Runtime = { draw: (src: CanvasImageSource, s: Record<string, unknown>) => void; destroy: () => void }

/** The live camera's depth relighting engine, on a canvas of its own. Null where WebGPU is missing (then a flatter 2D light is used). */
let engine: Promise<Runtime | null> | undefined
let ready: Runtime | null = null
const out = document.createElement('canvas')

export function loadRelight(): Promise<unknown> {
  engine ??= (async () => {
    if (!navigator.gpu) return null
    const { DepthRuntime } = await import('../depthRuntime')
    const r = new DepthRuntime()
    try { await r.init(out); return (ready = r as unknown as Runtime) } catch { r.destroy(); return null }
  })()
  // without the GPU engine, the 2D light needs the person cut-out model
  return engine.then((r): unknown => r ?? loadSegmenter())
}
export const relightReady = () => !!ready

const rgb = (h: Hue | 'white', warmth: number, t: number) => (h === 'white' ? lightColor(warmth) : hueColor(h, t * 1000))

let lastKey = '', lastT = -1

/** The clip's picture with its lighting, or null until the engine (or the cut-out model) has loaded */
export function relight(src: CanvasImageSource, w: number, h: number, L: Lighting, clipId: string, t: number): CanvasImageSource | null {
  if (!ready) return relight2d(src, w, h, L, `${clipId}:${t.toFixed(3)}`, t)
  const s = Math.min(1, 1280 / Math.max(w, h)), cw = Math.round(w * s), ch = Math.round(h * s)
  if (out.width !== cw || out.height !== ch) { out.width = cw; out.height = ch }
  const soft = L.soft / 100
  const back = L.back === 'off' ? [0, 0, 0, 0] : [...rgb(L.back, 0, t), 0.25 + (L.backLevel / 100) * 1.25]
  const settings = {
    lightPosition: [L.x, L.y], lightZ: 0.35 + soft * 0.45, falloff: 0.35 + soft * 0.75, lightColor: rgb(L.keyHue, L.warmth, t),
    intensity: (L.key / 100) * 10, exposure: L.room / 100, relief: 0.75 - soft * 0.35, specular: 0.22 - soft * 0.12, shadow: 0.45 - soft * 0.3, occlusion: 0.35,
    bulb: 0, skinSoften: 0.25, mirror: false, backColor: back, backPosition: [L.backSide / 100, 0.25],
  }
  // the depth model smooths over time; after a jump (seeking, another clip) a second pass lets it settle on the new picture
  const jumped = clipId !== lastKey || Math.abs(t - lastT) > 0.2
  lastKey = clipId; lastT = t
  ready.draw(src, settings)
  if (jumped) ready.draw(src, settings)
  return out
}

// ---------- 2D light for devices without WebGPU: light added only where it would land, using the person cut-out ----------
let flat: OffscreenCanvas | null = null, layer: OffscreenCanvas | null = null
const sized = (c: OffscreenCanvas | null, w: number, h: number) => { c ??= new OffscreenCanvas(w, h); if (c.width !== w || c.height !== h) { c.width = w; c.height = h } return c }
const css = ([r, g, b]: number[], a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`

function relight2d(src: CanvasImageSource, w: number, h: number, L: Lighting, key: string, t: number): OffscreenCanvas | null {
  const mask = personMask(src as TexImageSource, key)
  if (!mask) return null
  const W = Math.round(Math.min(w, 1280)), H = Math.round(W * h / w)
  flat = sized(flat, W, H); layer = sized(layer, W, H)
  const o = flat.getContext('2d')!, l = layer.getContext('2d')!
  o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1
  o.drawImage(src, 0, 0, W, H)
  o.fillStyle = `rgba(0,0,0,${(1 - L.room / 100) * 0.85})`; o.fillRect(0, 0, W, H)
  // added light = the picture's own colours x the light's colour and falloff, so dark things stay dark (as with real light)
  const add = (cx: number, cy: number, radius: number, color: number[], amount: number, keep: 'destination-in' | 'destination-out') => {
    l.globalCompositeOperation = 'source-over'; l.clearRect(0, 0, W, H); l.drawImage(src, 0, 0, W, H)
    const gr = l.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gr.addColorStop(0, css(color)); gr.addColorStop(1, 'rgba(0,0,0,1)')
    l.globalCompositeOperation = 'multiply'; l.fillStyle = gr; l.fillRect(0, 0, W, H)
    l.globalCompositeOperation = keep; l.drawImage(mask, 0, 0, W, H)
    o.globalCompositeOperation = 'lighter'
    for (let left = amount; left > 0; left -= 1) { o.globalAlpha = Math.min(1, left); o.drawImage(layer!, 0, 0) }
    o.globalAlpha = 1
  }
  const size = Math.max(W, H)
  if (L.key > 0) add(L.x * W, L.y * H, size * (0.45 + L.soft / 100 * 0.6), rgb(L.keyHue, L.warmth, t), (L.key / 100) * 1.6, 'destination-in')
  if (L.back !== 'off') {
    const c = rgb(L.back, 0, t), cx = (L.backSide / 100) * W, cy = 0.25 * H
    add(cx, cy, size * 0.55, c, (L.backLevel / 100) * 2.2, 'destination-out')
    // a faint coloured haze, so even a dark wall shows the lamp
    const haze = o.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5)
    haze.addColorStop(0, css(c, 0.1 * L.backLevel / 100)); haze.addColorStop(1, css(c, 0))
    o.globalCompositeOperation = 'lighter'; o.fillStyle = haze; o.fillRect(0, 0, W, H)
  }
  o.globalCompositeOperation = 'source-over'
  return flat
}
