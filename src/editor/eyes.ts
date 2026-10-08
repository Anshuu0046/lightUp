import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

/** Eye effects that follow a person's real eyes: glowing, lightning, lasers and "Deal with it" shades */
export type EyeKind = 'glow' | 'lightning' | 'laser' | 'shades'
export type EyeFx = { kind: EyeKind; color: string; size: number }

export const EYE_FX: { id: EyeKind; name: string; color: string }[] = [
  { id: 'glow', name: 'Glowing eyes', color: '#35e0ff' },
  { id: 'lightning', name: 'Lightning eyes', color: '#7ad0ff' },
  { id: 'laser', name: 'Laser eyes', color: '#ff2f45' },
  { id: 'shades', name: 'Deal with it', color: '#000000' },
]
export const EYE_COLORS = ['#35e0ff', '#ffd84a', '#ff2f45', '#a45cff', '#4dff88', '#ffffff']

type Eye = { x: number; y: number; r: number; open: number }
/** both eyes in source fractions (x of width, y of height), radius in fractions of the width */
export type Eyes = [Eye, Eye]

let model: Promise<FaceLandmarker> | undefined
let ready: FaceLandmarker | null = null

/** One-picture-at-a-time face model (the editor jumps around in time, so the live camera's video mode doesn't fit) */
export function loadEyes() {
  return model ??= import('@mediapipe/tasks-vision').then(async ({ FaceLandmarker, FilesetResolver }) => {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate }, runningMode: 'IMAGE', numFaces: 1 })
    ready = await make('GPU').catch(() => make('CPU'))
    return ready
  }).catch(e => { model = undefined; throw e })
}
export const eyesReady = () => !!ready

const SIDES = [
  { iris: 468, edge: [469, 471], lid: [159, 145], corner: [33, 133] },
  { iris: 473, edge: [474, 476], lid: [386, 374], corner: [362, 263] },
] as const

function eyeFrom(m: NormalizedLandmark[], e: (typeof SIDES)[number], aspect: number): Eye {
  const dist = (a: number, b: number) => Math.hypot(m[a].x - m[b].x, (m[a].y - m[b].y) / aspect)
  return { x: m[e.iris].x, y: m[e.iris].y, r: dist(e.edge[0], e.edge[1]) / 2, open: dist(e.lid[0], e.lid[1]) / Math.max(dist(e.corner[0], e.corner[1]), 1e-4) }
}

// last result per clip, so a paused frame redraws for free and playback glides instead of jittering
const last = new Map<string, { t: number; eyes: Eyes | null }>()
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

export function findEyes(src: TexImageSource, srcW: number, srcH: number, key: string, t: number): Eyes | null {
  if (!ready) return null
  const prev = last.get(key)
  if (prev && Math.abs(prev.t - t) < 1e-4) return prev.eyes
  const marks = ready.detect(src as HTMLCanvasElement).faceLandmarks[0]
  let eyes: Eyes | null = null
  if (marks) {
    const aspect = srcW / srcH
    eyes = [eyeFrom(marks, SIDES[0], aspect), eyeFrom(marks, SIDES[1], aspect)]
    if (prev?.eyes && Math.abs(t - prev.t) < 0.2) {
      const p = prev.eyes, e = eyes
      eyes = [0, 1].map(i => ({ x: lerp(p[i].x, e[i].x, 0.6), y: lerp(p[i].y, e[i].y, 0.6), r: lerp(p[i].r, e[i].r, 0.4), open: lerp(p[i].open, e[i].open, 0.6) })) as Eyes
    }
  }
  last.set(key, { t, eyes })
  return eyes
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Draws the effect on a picture of size w × h centred on the origin; `local` is seconds since the clip began */
export function drawEyeFx(g: Ctx, eyes: Eyes, fx: EyeFx, w: number, h: number, t: number, local: number) {
  const px = (e: Eye) => ({ x: (e.x - 0.5) * w, y: (e.y - 0.5) * h, r: Math.max(2, e.r * w), open: Math.min(1, Math.max(0, (e.open - 0.1) / 0.1)) })
  const pair = [px(eyes[0]), px(eyes[1])].sort((a, b) => a.x - b.x)
  const size = fx.size
  g.save()
  if (fx.kind === 'shades') { shades(g, pair, fx, local); g.restore(); return }
  g.globalCompositeOperation = 'lighter'
  pair.forEach((e, side) => {
    const a = e.open
    if (a < 0.05) return
    const flicker = 0.85 + 0.15 * Math.sin(t * 40 + side * 2) * hash(Math.floor(t * 30) + side)
    const R = e.r * 3.4 * size
    // the iris itself lights up, then the bloom around it
    const core = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 1.25)
    core.addColorStop(0, rgba('#ffffff', 0.95 * a)); core.addColorStop(0.55, rgba(fx.color, 0.9 * a)); core.addColorStop(1, rgba(fx.color, 0))
    g.fillStyle = core; g.beginPath(); g.arc(e.x, e.y, e.r * 1.25, 0, Math.PI * 2); g.fill()
    const bloom = g.createRadialGradient(e.x, e.y, e.r * 0.6, e.x, e.y, R)
    bloom.addColorStop(0, rgba(fx.color, 0.55 * a * flicker)); bloom.addColorStop(1, rgba(fx.color, 0))
    g.fillStyle = bloom; g.beginPath(); g.arc(e.x, e.y, R, 0, Math.PI * 2); g.fill()
    if (fx.kind === 'glow') {
      // a thin lens streak across the eye
      const streak = g.createLinearGradient(e.x - R * 2, 0, e.x + R * 2, 0)
      streak.addColorStop(0, rgba(fx.color, 0)); streak.addColorStop(0.5, rgba(fx.color, 0.4 * a * flicker)); streak.addColorStop(1, rgba(fx.color, 0))
      g.fillStyle = streak; g.fillRect(e.x - R * 2, e.y - e.r * 0.18, R * 4, e.r * 0.36)
    } else if (fx.kind === 'lightning') bolts(g, e, fx, t, side, a)
    else if (fx.kind === 'laser') beam(g, e, fx, side, a * flicker, w, h)
  })
  g.restore()
}

function bolts(g: Ctx, e: { x: number; y: number; r: number }, fx: EyeFx, t: number, side: number, a: number) {
  const step = Math.floor(t * 14)
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (let b = 0; b < 6; b++) {
    const seed = step * 13 + b * 7 + side * 101
    if (hash(seed) < 0.25) continue
    let ang = hash(seed + 1) * Math.PI * 2, x = e.x + Math.cos(ang) * e.r * 0.9, y = e.y + Math.sin(ang) * e.r * 0.9
    const len = e.r * (3 + hash(seed + 2) * 6) * fx.size, segs = 7
    const pts: [number, number][] = [[x, y]]
    for (let s = 0; s < segs; s++) { ang += (hash(seed + 10 + s) - 0.5) * 1.6; x += Math.cos(ang) * len / segs; y += Math.sin(ang) * len / segs; pts.push([x, y]) }
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]) }
    g.shadowColor = fx.color; g.shadowBlur = e.r * 1.6
    g.strokeStyle = rgba(fx.color, 0.9 * a); g.lineWidth = Math.max(1.5, e.r * 0.2); path(); g.stroke()
    g.shadowBlur = 0
    g.strokeStyle = rgba('#ffffff', 0.95 * a); g.lineWidth = Math.max(1, e.r * 0.07); path(); g.stroke()
  }
}

function beam(g: Ctx, e: { x: number; y: number; r: number }, fx: EyeFx, side: number, a: number, w: number, h: number) {
  const dir = side === 0 ? -1 : 1
  const x2 = e.x + dir * w * 0.8, y2 = e.y + h * 0.1
  const ang = Math.atan2(y2 - e.y, x2 - e.x), len = Math.hypot(x2 - e.x, y2 - e.y), width = e.r * 0.9 * fx.size
  g.save(); g.translate(e.x, e.y); g.rotate(ang)
  const grad = g.createLinearGradient(0, 0, len, 0)
  grad.addColorStop(0, rgba('#ffffff', 0.95 * a)); grad.addColorStop(0.08, rgba(fx.color, 0.9 * a)); grad.addColorStop(1, rgba(fx.color, 0.15 * a))
  g.shadowColor = fx.color; g.shadowBlur = width * 2.2
  g.fillStyle = grad
  g.beginPath(); g.moveTo(0, -width * 0.5); g.lineTo(len, -width * 1.4); g.lineTo(len, width * 1.4); g.lineTo(0, width * 0.5); g.closePath(); g.fill()
  g.shadowBlur = 0
  g.fillStyle = rgba('#ffffff', 0.7 * a); g.fillRect(0, -width * 0.18, len * 0.8, width * 0.36)
  g.restore()
}

/** Pixel sunglasses that drop onto the nose */
function shades(g: Ctx, pair: { x: number; y: number; r: number }[], fx: EyeFx, local: number) {
  const [l, r] = pair
  const cx = (l.x + r.x) / 2, cy = (l.y + r.y) / 2, D = Math.max(8, Math.hypot(r.x - l.x, r.y - l.y)), roll = Math.atan2(r.y - l.y, r.x - l.x)
  // they slide down from just above the forehead, so they're in view even on a still preview frame
  const u = Math.min(1, local / 0.4)
  const fall = (1 - u) ** 3 * -D * 1.0
  const px = D * 0.09 * fx.size // one "pixel" of the pixel art
  const lensW = D * 0.92 * fx.size
  g.translate(cx, cy + fall); g.rotate(roll)
  g.fillStyle = '#0b0b0f'
  // each lens is rows of blocks that narrow toward the bottom, like pixel art
  const rows = [1, 1, 1, 1, 0.88, 0.7, 0.5]
  const lens = (centre: number) => rows.forEach((f, i) => g.fillRect(centre - (lensW * f) / 2, -px * 2 + i * px * 1.04, lensW * f, px * 1.06))
  lens(-D / 2); lens(D / 2)
  g.fillRect(-D / 2 + lensW / 2 - px * 0.2, -px * 2, D - lensW + px * 0.4, px * 1.06) // bridge
  g.fillRect(-D / 2 - lensW / 2 - D * 0.3, -px * 2, D * 0.3 + px * 0.2, px * 0.9) // arms
  g.fillRect(D / 2 + lensW / 2 - px * 0.2, -px * 2, D * 0.3 + px * 0.2, px * 0.9)
  g.fillStyle = 'rgba(255,255,255,.3)' // a glint across each lens
  for (const c of [-D / 2, D / 2]) g.fillRect(c - lensW * 0.34, -px * 1.4, lensW * 0.3, px * 0.55)
}
