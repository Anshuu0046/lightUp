import type { Face } from '../faceTracker'

export type Style = 'bulb' | 'ring' | 'window' | 'natural'
export type Look = { style: Style; brightness: number; warmth: number; catchlight: boolean; auto: boolean }
export const DEFAULT_LOOK: Look = { style: 'bulb', brightness: 60, warmth: 3200, catchlight: true, auto: true }
export const WARMTH_MIN = 2000, WARMTH_MAX = 12000

/** Where the light is in the frame (video fractions) and how close it is to the camera */
export type Spot = { x: number; y: number; z: number }

/** Everything the relighting pass needs, kept numeric so changes can glide instead of jump */
export type Rig = { x: number; y: number; z: number; falloff: number; intensity: number; exposure: number; relief: number; specular: number; shadow: number; occlusion: number; bulb: number; r: number; g: number; b: number; catch: number }

/** Colour of a light at a colour temperature, normalised so the brightest channel is 1 */
function kelvin(k: number): [number, number, number] {
  const t = k / 100
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332)
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  const c = [r, g, b].map(v => Math.max(0, Math.min(255, v)))
  const max = Math.max(...c)
  return [c[0] / max, c[1] / max, c[2] / max]
}

/** Warm tungsten through daylight white; past daylight it deepens into the saturated blue of an LED bulb */
export function lightColor(k: number): [number, number, number] {
  const c = kelvin(Math.min(k, 7000))
  const blue = Math.max(0, Math.min(1, (k - 7000) / (WARMTH_MAX - 7000)))
  const led: [number, number, number] = [0.32, 0.55, 1]
  return [c[0] + (led[0] - c[0]) * blue, c[1] + (led[1] - c[1]) * blue, c[2] + (led[2] - c[2]) * blue]
}

/**
 * Where a real light of this kind would sit, and how the room responds.
 * Bulb: a small bright source in your hand; the room drops into shadow so its pool of light reads, like a lamp at night.
 * Ring: right at the lens with a fast falloff, so the face lifts well above the room and shadows vanish.
 * Window: a big source off to one side at face height, so one side of the face lights and the other falls into soft shadow.
 */
export function rigFor(look: Look, face: Face | undefined, spot: Spot): Rig {
  const [r, g, b] = lightColor(look.warmth)
  const k = look.brightness / 100
  const fx = face?.x ?? 0.5, fy = face?.y ?? 0.45
  // a ring light's reflection is crisp and white; other lights read as softer glints
  const catchOn = !look.catchlight || look.style === 'natural' ? 0 : look.style === 'ring' ? 0.75 + k * 0.25 : 0.3 + k * 0.5
  if (look.style === 'bulb') return { ...spot, falloff: 0.5, intensity: 2 + k * 7, exposure: 0.42, relief: 0.7, specular: 0.2, shadow: 0.4, occlusion: 0.55, bulb: 1, r, g, b, catch: catchOn }
  if (look.style === 'ring') return { x: fx, y: fy - 0.05, z: 0.8, falloff: 0.45, intensity: 3 + k * 9, exposure: 0.62 - k * 0.1, relief: 0.45, specular: 0.14, shadow: 0.08, occlusion: 0.3, bulb: 0, r, g, b, catch: catchOn }
  if (look.style === 'window') return { x: fx - 0.6, y: fy - 0.15, z: 0.55, falloff: 0.9, intensity: 3 + k * 9, exposure: 0.42 - k * 0.08, relief: 0.7, specular: 0.14, shadow: 0.3, occlusion: 0.5, bulb: 0, r, g, b, catch: catchOn }
  return { x: fx, y: fy, z: 0.8, falloff: 0.45, intensity: 0, exposure: 1, relief: 0.45, specular: 0, shadow: 0, occlusion: 0, bulb: 0, r, g, b, catch: 0 }
}

export function glide(cur: Rig, target: Rig, t = 0.14) {
  for (const key in target) { const k = key as keyof Rig; cur[k] += (target[k] - cur[k]) * t }
}

/**
 * Paints the reflection of the light inside each iris: soft, small, clipped to the iris, and gone while blinking.
 * Ring: a thin ring. Window: a small pane toward the window. Bulb: a bright point toward the bulb.
 */
export function drawCatchlights(g: CanvasRenderingContext2D, W: number, H: number, face: Face | undefined, style: Style, strength: number, tint: [number, number, number], light: { x: number; y: number }) {
  g.clearRect(0, 0, W, H)
  if (!face || strength < 0.02) return
  const color = (a: number) => `rgba(${Math.round(215 + 40 * tint[0])},${Math.round(215 + 40 * tint[1])},${Math.round(215 + 40 * tint[2])},${a})`
  for (const eye of face.eyes) {
    const open = Math.min(1, Math.max(0, (eye.open - 0.12) / 0.1))
    const a = strength * open
    const cx = eye.x * W, cy = eye.y * H, r = eye.r * W
    if (a < 0.02 || r < 2) continue
    // the cornea mirrors the light from the side it comes from
    const dx = Math.max(-1, Math.min(1, (light.x - eye.x) * 4)), dy = Math.max(-1, Math.min(1, (light.y - eye.y) * 4))
    g.save()
    g.beginPath(); g.arc(cx, cy, r * 0.95, 0, Math.PI * 2); g.clip()
    g.globalCompositeOperation = 'screen'
    g.filter = `blur(${Math.max(0.4, r * (style === 'ring' ? 0.035 : 0.09)).toFixed(2)}px)`
    if (style === 'ring') {
      // a thin, bright ring: the sharp mirror image of the light on the wet cornea
      g.lineWidth = Math.max(1, r * 0.07); g.strokeStyle = color(0.8 * a)
      g.beginPath(); g.arc(cx, cy - r * 0.05, r * 0.4, 0, Math.PI * 2); g.stroke()
    } else if (style === 'window') {
      const w = r * 0.38, h = r * 0.46, x = cx + dx * r * 0.45 - w / 2, y = cy - r * 0.35 - h / 2
      g.fillStyle = color(0.55 * a); g.beginPath(); g.roundRect(x, y, w, h, r * 0.08); g.fill()
    } else {
      const R = r * 0.18
      const grad = g.createRadialGradient(cx + dx * r * 0.45, cy + dy * r * 0.45, 0, cx + dx * r * 0.45, cy + dy * r * 0.45, R)
      grad.addColorStop(0, color(0.9 * a)); grad.addColorStop(1, color(0))
      g.fillStyle = grad; g.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    g.restore()
  }
  g.filter = 'none'
}
