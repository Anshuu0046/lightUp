import { activeAt, type Clip, type Project } from './model'

/** Visual clips showing at time t, bottom layer first (the track list runs top to bottom) */
export function layersAt(p: Project, t: number): Clip[] {
  const order = p.tracks.filter(tr => tr.kind === 'visual' && !tr.hidden).map(tr => tr.id).reverse()
  return order.flatMap(id => p.clips.filter(c => c.trackId === id && activeAt(c, t)))
}

/** Draws one source (video frame or image) the way a clip's transform says: fitted inside the frame, then moved, scaled and turned */
export function drawClip(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, clip: Clip, W: number, H: number) {
  if (!srcW || !srcH) return
  const fit = Math.min(W / srcW, H / srcH) * clip.transform.scale
  const w = srcW * fit, h = srcH * fit
  g.save()
  g.globalAlpha = clip.opacity
  g.translate(clip.transform.x * W, clip.transform.y * H)
  g.rotate((clip.transform.rotation * Math.PI) / 180)
  g.drawImage(src, -w / 2, -h / 2, w, h)
  g.restore()
}
