/** Colour lookup tables: the built-in film looks, and .cube files the user brings. A LUT maps every colour to a new one. */

export type ClipLut = { id: string; strength: number }
/** An imported .cube, stored in the project as base64 bytes (size³ RGB triples, red varying fastest) */
export type CustomLut = { id: string; name: string; size: number; data: string }
export type Lut3D = { size: number; data: Uint8ClampedArray }

const SIZE = 17
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const mix = (a: number, b: number, u: number) => a + (b - a) * u
const luma = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722
const sCurve = (v: number, k: number) => clamp(v + (v - 0.5) * (1 - Math.abs(v - 0.5) * 2) * k)
const sat = (c: [number, number, number], s: number): [number, number, number] => { const l = luma(...c); return [mix(l, c[0], s), mix(l, c[1], s), mix(l, c[2], s)] }
type Fn = (r: number, g: number, b: number) => [number, number, number]

export const BUILTIN_LUTS: { id: string; name: string; fn: Fn }[] = [
  { id: 'teal-orange', name: 'Teal & orange', fn: (r, g, b) => { const l = luma(r, g, b), sh = 1 - l, hi = l; return [r + hi * 0.12 - sh * 0.08, g + hi * 0.02 + sh * 0.03, b - hi * 0.1 + sh * 0.14] } },
  { id: 'bleach', name: 'Bleach bypass', fn: (r, g, b) => { const c = sat([r, g, b], 0.45); return [sCurve(c[0], 0.5), sCurve(c[1], 0.5), sCurve(c[2], 0.5)] } },
  { id: 'cross', name: 'Cross process', fn: (r, g, b) => [sCurve(r, 0.7) + 0.03, sCurve(g, 0.2), mix(0.12, 0.88, b) * (0.85 + 0.15 * (1 - b))] },
  { id: 'film', name: 'Faded film', fn: (r, g, b) => { const c = sat([mix(0.07, 0.96, r), mix(0.06, 0.94, g), mix(0.09, 0.9, b)], 0.85); return [c[0] + 0.02, c[1], c[2] - 0.02] } },
  { id: 'moody', name: 'Moody blue', fn: (r, g, b) => { const l = luma(r, g, b); const c = sat([r * 0.9, g * 0.96, b * 1.08], 0.7); return [sCurve(c[0], 0.35) - (1 - l) * 0.03, sCurve(c[1], 0.35), sCurve(c[2], 0.35) + (1 - l) * 0.06] } },
  { id: 'sunset', name: 'Sunset', fn: (r, g, b) => [clamp(r * 1.1 + 0.05), g * 0.92, clamp(b * 0.85 + luma(r, g, b) * 0.12)] },
  { id: 'cyber', name: 'Cyberpunk', fn: (r, g, b) => { const l = luma(r, g, b); const c = sat([r, g, b], 1.25); return [sCurve(c[0] + (1 - l) * 0.14, 0.4), sCurve(c[1] - (1 - l) * 0.04 + l * 0.04, 0.4), sCurve(c[2] + l * 0.12 + (1 - l) * 0.08, 0.4)] } },
  { id: 'mint', name: 'Fresh mint', fn: (r, g, b) => { const c = sat([r, g, b], 0.9); return [c[0] * 0.94, c[1] * 1.04 + 0.02, c[2] * 0.98 + 0.02] } },
  { id: 'sepia', name: 'Sepia', fn: (r, g, b) => { const l = luma(r, g, b); return [clamp(l * 1.18 + 0.04), clamp(l * 1.02), clamp(l * 0.8)] } },
  { id: 'drama', name: 'Drama', fn: (r, g, b) => { const c = sat([r, g, b], 1.15); return [sCurve(c[0], 0.9), sCurve(c[1], 0.9), sCurve(c[2], 0.9)] } },
]

const built = new Map<string, Lut3D>()
function build(fn: Fn): Lut3D {
  const data = new Uint8ClampedArray(SIZE ** 3 * 3)
  let o = 0
  for (let b = 0; b < SIZE; b++) for (let g = 0; g < SIZE; g++) for (let r = 0; r < SIZE; r++) {
    const [R, G, B] = fn(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1))
    data[o++] = clamp(R) * 255; data[o++] = clamp(G) * 255; data[o++] = clamp(B) * 255
  }
  return { size: SIZE, data }
}

// ---------- imported .cube files ----------

const custom = new Map<string, CustomLut>()
const decoded = new Map<string, Lut3D>()

/** Tells the renderer which imported LUTs the project holds (call whenever the project changes) */
export function setCustomLuts(list: CustomLut[] | undefined) {
  custom.clear()
  for (const l of list ?? []) custom.set(l.id, l)
}

export function lutData(id: string): Lut3D | null {
  const cached = built.get(id) ?? decoded.get(id)
  if (cached) return cached
  const b = BUILTIN_LUTS.find(x => x.id === id)
  if (b) { const l = build(b.fn); built.set(id, l); return l }
  const c = custom.get(id)
  if (!c) return null
  const bin = atob(c.data), data = new Uint8ClampedArray(bin.length)
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  const l = { size: c.size, data }
  decoded.set(id, l)
  return l
}

/** Reads a 3D .cube file; anything bigger than 33 points a side is resampled so projects stay small */
export function parseCube(text: string, name: string): CustomLut {
  let size = 0
  let lo = [0, 0, 0], hi = [1, 1, 1]
  const rows: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [key, ...rest] = line.split(/\s+/)
    if (key === 'LUT_3D_SIZE') size = parseInt(rest[0], 10)
    else if (key === 'LUT_1D_SIZE') throw new Error('That is a 1D LUT. Light Up reads 3D .cube files.')
    else if (key === 'DOMAIN_MIN') lo = rest.map(Number)
    else if (key === 'DOMAIN_MAX') hi = rest.map(Number)
    else if (/^[-\d.]/.test(key)) rows.push(+key, +rest[0], +rest[1])
  }
  if (size < 2 || rows.length !== size ** 3 * 3 || rows.some(v => Number.isNaN(v))) throw new Error('That .cube file couldn’t be read.')
  const norm = (v: number, c: number) => clamp((v - lo[c]) / (hi[c] - lo[c] || 1))
  const out = Math.min(size, 33)
  const bytes = new Uint8Array(out ** 3 * 3)
  const at = (r: number, g: number, b: number, c: number) => norm(rows[((b * size + g) * size + r) * 3 + c], c)
  let o = 0
  for (let b = 0; b < out; b++) for (let g = 0; g < out; g++) for (let r = 0; r < out; r++) for (let c = 0; c < 3; c++) {
    if (out === size) bytes[o++] = at(r, g, b, c) * 255
    else {
      // nearest source sample is plenty for a 33-point grid made from a finer one
      const f = (v: number) => Math.round((v / (out - 1)) * (size - 1))
      bytes[o++] = at(f(r), f(g), f(b), c) * 255
    }
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { id: 'cube-' + Math.random().toString(36).slice(2, 8), name: name.replace(/\.cube$/i, '').slice(0, 40), size: out, data: btoa(bin) }
}

/** Runs a LUT over the pixels of a canvas (trilinear), blending with the original by `strength` */
export function applyLut(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, lut: Lut3D, strength: number) {
  const img = g.getImageData(0, 0, w, h), d = img.data
  const n = lut.size - 1, S = lut.size, S2 = S * S, L = lut.data
  const k = clamp(strength)
  for (let i = 0; i < d.length; i += 4) {
    const rf = (d[i] / 255) * n, gf = (d[i + 1] / 255) * n, bf = (d[i + 2] / 255) * n
    const r0 = rf | 0, g0 = gf | 0, b0 = bf | 0
    const r1 = r0 < n ? r0 + 1 : r0, g1 = g0 < n ? g0 + 1 : g0, b1 = b0 < n ? b0 + 1 : b0
    const fr = rf - r0, fg = gf - g0, fb = bf - b0
    for (let c = 0; c < 3; c++) {
      const v = (r: number, g: number, b: number) => L[(b * S2 + g * S + r) * 3 + c]
      const c00 = mix(v(r0, g0, b0), v(r1, g0, b0), fr), c10 = mix(v(r0, g1, b0), v(r1, g1, b0), fr)
      const c01 = mix(v(r0, g0, b1), v(r1, g0, b1), fr), c11 = mix(v(r0, g1, b1), v(r1, g1, b1), fr)
      const out = mix(mix(c00, c10, fg), mix(c01, c11, fg), fb)
      d[i + c] = k >= 1 ? out : mix(d[i + c], out, k)
    }
  }
  g.putImageData(img, 0, 0)
}
