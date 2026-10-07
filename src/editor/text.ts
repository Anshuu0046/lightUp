import '@fontsource/anton'
import '@fontsource/bebas-neue'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/800.css'
import '@fontsource/pacifico'
import '@fontsource/permanent-marker'
import '@fontsource-variable/montserrat'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/noto-sans-devanagari'
import '@fontsource-variable/noto-sans-telugu'

export type TextAnim = 'none' | 'fade' | 'pop' | 'slide' | 'typewriter' | 'bounce'
export type TextBg = 'none' | 'box' | 'pill' | 'highlight'
export type TextSpec = {
  content: string
  font: string
  weight: number
  /** size in pixels on a 1080-wide frame */
  size: number
  color: string
  /** optional second colour for a top-to-bottom gradient fill */
  color2: string | null
  align: 'left' | 'center' | 'right'
  /** wrapping width as a share of the frame width */
  width: number
  lineHeight: number
  spacing: number
  uppercase: boolean
  italic: boolean
  /** outline thickness, 0-1 */
  stroke: number
  strokeColor: string
  /** drop shadow strength, 0-1 */
  shadow: number
  bg: TextBg
  bgColor: string
  bgOpacity: number
  animIn: TextAnim
  animOut: Exclude<TextAnim, 'typewriter' | 'bounce'>
}

export const FONTS: { family: string; label: string; weights: number[] }[] = [
  { family: 'Poppins', label: 'Poppins', weights: [500, 800] },
  { family: 'Montserrat Variable', label: 'Montserrat', weights: [400, 600, 800, 900] },
  { family: 'Manrope Variable', label: 'Manrope', weights: [500, 700, 800] },
  { family: 'Anton', label: 'Anton (meme)', weights: [400] },
  { family: 'Bebas Neue', label: 'Bebas Neue', weights: [400] },
  { family: 'Playfair Display Variable', label: 'Playfair', weights: [500, 700, 900] },
  { family: 'Instrument Serif', label: 'Instrument Serif', weights: [400] },
  { family: 'Pacifico', label: 'Pacifico', weights: [400] },
  { family: 'Permanent Marker', label: 'Marker', weights: [400] },
  { family: 'Noto Sans Devanagari Variable', label: 'Noto Hindi', weights: [500, 700, 800] },
  { family: 'Noto Sans Telugu Variable', label: 'Noto Telugu', weights: [500, 700, 800] },
]
/** Any Latin font still shows Hindi and Telugu letters, by falling back to Noto for those scripts */
const FALLBACK = `"Noto Sans Devanagari Variable", "Noto Sans Telugu Variable", "Manrope Variable", sans-serif`

export const BASE_TEXT: TextSpec = {
  content: 'Your text', font: 'Poppins', weight: 800, size: 84, color: '#ffffff', color2: null, align: 'center', width: 0.8,
  lineHeight: 1.15, spacing: 0, uppercase: false, italic: false, stroke: 0, strokeColor: '#000000', shadow: 0.5,
  bg: 'none', bgColor: '#000000', bgOpacity: 0.6, animIn: 'pop', animOut: 'fade',
}

export const TEXT_TEMPLATES: { id: string; name: string; spec: Partial<TextSpec> }[] = [
  { id: 'bold', name: 'Bold', spec: {} },
  { id: 'caption', name: 'Caption', spec: { font: 'Montserrat Variable', weight: 800, size: 62, stroke: 0.55, shadow: 0.4, animIn: 'pop' } },
  { id: 'box', name: 'Subtitle box', spec: { font: 'Manrope Variable', weight: 700, size: 52, shadow: 0, bg: 'box', bgOpacity: 0.65, animIn: 'fade' } },
  { id: 'highlight', name: 'Highlight', spec: { font: 'Poppins', weight: 800, size: 64, color: '#141218', bg: 'highlight', bgColor: '#ffd84a', bgOpacity: 1, shadow: 0, animIn: 'slide' } },
  { id: 'meme', name: 'Meme', spec: { font: 'Anton', weight: 400, size: 110, uppercase: true, stroke: 1, shadow: 0, animIn: 'none', animOut: 'none' } },
  { id: 'title', name: 'Serif title', spec: { font: 'Instrument Serif', weight: 400, size: 130, italic: true, shadow: 0.35, animIn: 'fade' } },
  { id: 'neon', name: 'Neon', spec: { font: 'Montserrat Variable', weight: 900, size: 92, color: '#ff4fd8', color2: '#6ae4ff', shadow: 1, animIn: 'bounce' } },
  { id: 'cinema', name: 'Cinema', spec: { font: 'Bebas Neue', weight: 400, size: 120, spacing: 0.25, shadow: 0.3, animIn: 'fade' } },
  { id: 'pill', name: 'Pill', spec: { font: 'Poppins', weight: 800, size: 56, color: '#ffffff', bg: 'pill', bgColor: '#7c5cff', bgOpacity: 1, shadow: 0, animIn: 'pop' } },
  { id: 'typewriter', name: 'Typewriter', spec: { font: 'Manrope Variable', weight: 700, size: 60, shadow: 0.4, animIn: 'typewriter' } },
  { id: 'script', name: 'Script', spec: { font: 'Pacifico', weight: 400, size: 96, color: '#fff3d6', shadow: 0.6, animIn: 'fade' } },
  { id: 'marker', name: 'Marker', spec: { font: 'Permanent Marker', weight: 400, size: 90, color: '#ffe14a', stroke: 0.4, shadow: 0, animIn: 'pop' } },
]

const fontString = (s: TextSpec, px: number) => `${s.italic ? 'italic ' : ''}${s.weight} ${px}px "${s.font}", ${FALLBACK}`

/** Waits until a font is ready, so the first frame isn't drawn in a fallback font */
export async function ensureFont(s: Pick<TextSpec, 'font' | 'weight' | 'italic'>) {
  try { await document.fonts.load(`${s.italic ? 'italic ' : ''}${s.weight} 48px "${s.font}"`) } catch { /* fall back */ }
}

const graphemes = (s: string) => (typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment) : [...s])

/** Breaks text into lines no wider than `max`, keeping manual line breaks */
function wrap(g: OffscreenCanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter(Boolean)
    let line = ''
    for (const w of words) {
      const next = line + w
      if (line.trim() && g.measureText(next.trimEnd()).width > max) { lines.push(line.trimEnd()); line = w.trimStart() }
      else line = next
    }
    lines.push(line.trimEnd())
  }
  return lines
}

const cache = new Map<string, OffscreenCanvas>()

/**
 * Draws a text block (wrapped, outlined, boxed) at frame scale. `chars` limits how many characters show,
 * for the typewriter animation. Results are cached, since text rarely changes between frames.
 */
export function renderText(s: TextSpec, frameW: number, chars = Infinity): OffscreenCanvas {
  const key = JSON.stringify(s) + frameW + ':' + (chars === Infinity ? '' : chars)
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 80) cache.clear()

  const k = frameW / 1080, px = s.size * k
  const measure = new OffscreenCanvas(8, 8).getContext('2d')!
  measure.font = fontString(s, px)
  ;(measure as unknown as { letterSpacing: string }).letterSpacing = `${s.spacing * px * 0.2}px`
  const text = s.uppercase ? s.content.toUpperCase() : s.content
  const lines = wrap(measure, text, s.width * frameW)
  const lineH = px * s.lineHeight
  const widths = lines.map(l => measure.measureText(l).width)
  const pad = px * (s.bg === 'none' ? 0.35 : 0.45) + s.stroke * px * 0.12 + s.shadow * px * 0.35
  const W = Math.ceil(Math.max(1, ...widths) + pad * 2), H = Math.ceil(lines.length * lineH + pad * 2)
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d')!
  g.font = measure.font
  ;(g as unknown as { letterSpacing: string }).letterSpacing = `${s.spacing * px * 0.2}px`
  g.textBaseline = 'middle'
  const xFor = (w: number) => (s.align === 'left' ? pad : s.align === 'right' ? W - pad - w : (W - w) / 2)

  // backgrounds: one box for the block, or a shape per line
  if (s.bg !== 'none') {
    g.save(); g.globalAlpha = s.bgOpacity; g.fillStyle = s.bgColor
    if (s.bg === 'box') { g.beginPath(); g.roundRect(pad * 0.35, pad * 0.35, W - pad * 0.7, H - pad * 0.7, px * 0.25); g.fill() }
    else lines.forEach((l, i) => {
      if (!l) return
      const y = pad + i * lineH, w = widths[i], x = xFor(w), padX = px * (s.bg === 'pill' ? 0.4 : 0.18)
      g.beginPath(); g.roundRect(x - padX, y + lineH * 0.06, w + padX * 2, lineH * 0.92, s.bg === 'pill' ? lineH : px * 0.12); g.fill()
    })
    g.restore()
  }

  // typewriter: reveal characters across lines in reading order
  let left = chars
  const shown = lines.map(l => { const gs = graphemes(l); const part = gs.slice(0, Math.max(0, left)).join(''); left -= gs.length; return part })

  const fill: string | CanvasGradient = s.color2 ? (() => { const gr = g.createLinearGradient(0, pad, 0, H - pad); gr.addColorStop(0, s.color); gr.addColorStop(1, s.color2!); return gr })() : s.color
  shown.forEach((l, i) => {
    if (!l) return
    const y = pad + i * lineH + lineH / 2, x = xFor(widths[i])
    if (s.shadow > 0) { g.shadowColor = s.color2 && s.shadow > 0.8 ? s.color : 'rgba(0,0,0,.65)'; g.shadowBlur = px * 0.3 * s.shadow; g.shadowOffsetY = s.color2 && s.shadow > 0.8 ? 0 : px * 0.06 * s.shadow }
    if (s.stroke > 0) { g.lineJoin = 'round'; g.lineWidth = px * 0.16 * s.stroke; g.strokeStyle = s.strokeColor; g.strokeText(l, x, y); g.shadowColor = 'transparent' }
    g.fillStyle = fill; g.fillText(l, x, y)
    g.shadowColor = 'transparent'
  })
  cache.set(key, c)
  return c
}

/** How an animation changes a text clip at `local` seconds into a clip of `len` seconds */
export function textMotion(s: TextSpec, local: number, len: number) {
  const IN = Math.min(0.45, len / 3), OUT = Math.min(0.35, len / 3)
  const pi = Math.min(1, local / IN), po = Math.min(1, (len - local) / OUT)
  const ease = (x: number) => 1 - Math.pow(1 - x, 3)
  // overshoots a little before settling, like a sticker slapped on
  const back = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2)
  let alpha = 1, scale = 1, dy = 0, chars = Infinity
  switch (s.animIn) {
    case 'fade': alpha *= ease(pi); break
    case 'pop': scale *= 0.6 + 0.4 * back(pi); alpha *= Math.min(1, pi * 3); break
    case 'slide': dy += (1 - ease(pi)) * 0.06; alpha *= ease(pi); break
    case 'bounce': scale *= pi < 1 ? 1 + Math.sin(pi * Math.PI * 2.5) * (1 - pi) * 0.35 : 1; alpha *= Math.min(1, pi * 4); break
    case 'typewriter': chars = Math.floor(graphemes(s.content).length * Math.min(1, local / Math.max(0.6, Math.min(len * 0.6, s.content.length * 0.05)))); break
  }
  switch (s.animOut) {
    case 'fade': alpha *= ease(po); break
    case 'pop': scale *= 0.6 + 0.4 * ease(po); alpha *= Math.min(1, po * 3); break
    case 'slide': dy -= (1 - ease(po)) * 0.06; alpha *= ease(po); break
  }
  return { alpha, scale, dy, chars }
}
