import { activeAt, type Clip, clipLength, type Project } from './model'
import { type Fx, type Grade, NO_FX, NO_GRADE } from './looks'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Visual clips showing at time t, bottom layer first (the track list runs top to bottom) */
export function layersAt(p: Project, t: number): Clip[] {
  const order = p.tracks.filter(tr => tr.kind === 'visual' && !tr.hidden).map(tr => tr.id).reverse()
  return order.flatMap(id => p.clips.filter(c => c.trackId === id && activeAt(c, t)))
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// scratch canvases, reused every frame
let layer: OffscreenCanvas | null = null
const grainTiles: OffscreenCanvas[] = []
function scratch(w: number, h: number) {
  if (!layer) layer = new OffscreenCanvas(w, h)
  if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h }
  return layer
}
function grain(frame: number) {
  if (!grainTiles.length) for (let k = 0; k < 4; k++) {
    const c = new OffscreenCanvas(160, 160), g = c.getContext('2d')!, img = g.createImageData(160, 160)
    for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
    g.putImageData(img, 0, 0); grainTiles.push(c)
  }
  return grainTiles[frame % grainTiles.length]
}

const isPlain = (g: Grade, f: Fx) => !g.brightness && !g.contrast && !g.saturation && !g.warmth && !g.tint && !g.fade && !g.vignette && !g.grain && !g.blur && !g.mono && !f.glow && !f.glitch

function filterFor(g: Grade, scale: number) {
  return `brightness(${1 + g.brightness * 0.6}) contrast(${1 + g.contrast * 0.7}) saturate(${g.mono ? 0 : Math.max(0, 1 + g.saturation)})${g.blur > 0 ? ` blur(${(g.blur * 14 * scale).toFixed(1)}px)` : ''}`
}

/**
 * Draws one source (video frame or image) as a clip at timeline time t: graded, with its effects,
 * fitted inside the frame, then moved, scaled and turned. Preview and export both come through here.
 */
export function drawClip(g: Ctx, src: CanvasImageSource, srcW: number, srcH: number, clip: Clip, W: number, H: number, t: number) {
  if (!srcW || !srcH) return
  const grade = { ...NO_GRADE, ...clip.grade }, fx = { ...NO_FX, ...clip.fx }
  const local = t - clip.start, len = clipLength(clip)
  let alpha = clip.opacity
  if (fx.fadeIn > 0) alpha *= clamp01(local / fx.fadeIn)
  if (fx.fadeOut > 0) alpha *= clamp01((len - local) / fx.fadeOut)
  if (alpha <= 0.001) return
  const scale = W / 1080 // effect sizes are designed at 1080 wide
  const push = 1 + fx.zoom * 0.22 * clamp01(local / Math.max(len, 0.01))
  const fit = Math.min(W / srcW, H / srcH) * clip.transform.scale * push
  const w = Math.max(1, Math.round(srcW * fit)), h = Math.max(1, Math.round(srcH * fit))
  // camera shake: smooth wobble built from a few sine waves, stronger with the setting
  const shakeX = fx.shake ? (Math.sin(t * 17.3) + Math.sin(t * 29.1) * 0.5) * fx.shake * 14 * scale : 0
  const shakeY = fx.shake ? (Math.sin(t * 21.7) + Math.sin(t * 33.9) * 0.5) * fx.shake * 14 * scale : 0
  const shakeR = fx.shake ? Math.sin(t * 13.1) * fx.shake * 0.6 : 0

  let picture: CanvasImageSource = src
  if (!isPlain(grade, fx)) {
    const L = scratch(w, h), lg = L.getContext('2d')!
    lg.globalCompositeOperation = 'source-over'; lg.globalAlpha = 1
    lg.clearRect(0, 0, w, h)
    lg.filter = filterFor(grade, scale)
    lg.drawImage(src, 0, 0, w, h)
    lg.filter = 'none'
    // colour casts and film looks, layered on top of the picture
    if (grade.warmth) { lg.globalCompositeOperation = 'soft-light'; lg.globalAlpha = Math.abs(grade.warmth) * 0.55; lg.fillStyle = grade.warmth > 0 ? '#ff9a3c' : '#3c8cff'; lg.fillRect(0, 0, w, h) }
    if (grade.tint) { lg.globalCompositeOperation = 'soft-light'; lg.globalAlpha = Math.abs(grade.tint) * 0.45; lg.fillStyle = grade.tint > 0 ? '#ff3cc8' : '#2dd47c'; lg.fillRect(0, 0, w, h) }
    if (grade.fade) { lg.globalCompositeOperation = 'screen'; lg.globalAlpha = grade.fade * 0.6; lg.fillStyle = '#3a3640'; lg.fillRect(0, 0, w, h) }
    if (grade.grain) { lg.globalCompositeOperation = 'overlay'; lg.globalAlpha = grade.grain * 0.16; lg.fillStyle = lg.createPattern(grain(Math.floor(t * 24)), 'repeat')!; lg.fillRect(0, 0, w, h) }
    if (grade.vignette) {
      lg.globalCompositeOperation = 'source-over'; lg.globalAlpha = 1
      const r = Math.hypot(w, h) / 2, v = lg.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r)
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, grade.vignette * 0.85)})`)
      lg.fillStyle = v; lg.fillRect(0, 0, w, h)
    }
    // keep the source's own transparency (stickers and cut-outs) after all the fills
    lg.globalCompositeOperation = 'destination-in'; lg.globalAlpha = 1
    lg.drawImage(src, 0, 0, w, h)
    lg.globalCompositeOperation = 'source-over'
    picture = L
  }

  g.save()
  g.globalAlpha = alpha
  g.translate(clip.transform.x * W + shakeX, clip.transform.y * H + shakeY)
  g.rotate(((clip.transform.rotation + shakeR) * Math.PI) / 180)
  const glitching = fx.glitch > 0 && hash(Math.floor(t * 12) + clip.start) < fx.glitch * 0.7
  if (glitching) {
    // a few horizontal bands knocked sideways, plus a faint colour ghost
    const bands = 6
    for (let i = 0; i < bands; i++) {
      const y0 = (h / bands) * i, dx = (hash(i + Math.floor(t * 12) * 7) - 0.5) * fx.glitch * 90 * scale
      g.drawImage(picture, 0, (y0 / h) * h, w, h / bands, -w / 2 + dx, -h / 2 + y0, w, h / bands)
    }
    g.globalCompositeOperation = 'screen'; g.globalAlpha = alpha * 0.35
    g.drawImage(picture, -w / 2 + 8 * scale * fx.glitch, -h / 2, w, h)
  } else {
    g.drawImage(picture, -w / 2, -h / 2, w, h)
  }
  if (fx.glow > 0) {
    g.globalCompositeOperation = 'screen'; g.globalAlpha = alpha * fx.glow * 0.7
    g.filter = `blur(${(18 * scale).toFixed(1)}px) brightness(1.15)`
    g.drawImage(picture, -w / 2, -h / 2, w, h)
  }
  g.restore()

  if (fx.flash && local < 0.35) { g.save(); g.globalAlpha = (1 - local / 0.35) * 0.9 * alpha; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.restore() }
  if (fx.bars) {
    const bar = W >= H ? Math.max(0, (H - W / 2.39) / 2) : H * 0.07 // 2.39:1 on wide frames; slim bands on tall ones, so the picture survives
    g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar); g.restore()
  }
}
