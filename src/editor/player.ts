import { activeAt, ASPECTS, type Clip, clipEnd, projectDuration, type Project, sourceTime } from './model'
import { urlOf } from './media'
import { drawClip, drawTextClip, layersAt } from './render'
import { clipChain, clipGainAt, envelopeAt, isMusicTrack, NO_AUDIO } from './audio'
import { loadSegmenter, segmenterReady } from './segment'
import { loadRelight, relightReady } from './relight'
import { frameAt, loadAnimation } from './anim'
import { fileOf } from './media'

const PREVIEW_SCALE = 0.5 // preview at half the export size: smooth on laptops, sharp enough to judge

/**
 * Plays the project into a canvas. Each clip gets its own media element so the same file can play
 * at two different moments; elements are seeked when paused and kept in step while playing.
 */
export class Player {
  time = 0
  playing = false
  onTime: (t: number) => void = () => {}
  private els = new Map<string, HTMLVideoElement | HTMLAudioElement>()
  private images = new Map<string, HTMLImageElement>()
  private frame = 0
  private clockStart = 0
  private timeStart = 0
  private project: Project
  private audio: AudioContext | null = null
  private routes = new Map<string, { src: MediaElementAudioSourceNode; gain: GainNode; duck: GainNode; enhance: boolean; tail: AudioNode }>()
  private duckEnv: Float32Array | null = null

  constructor(private canvas: HTMLCanvasElement, project: Project) { this.project = project }

  /** the music's gain curve for ducking, or null when ducking is off */
  setDucking(env: Float32Array | null) { this.duckEnv = env }

  setProject(p: Project) {
    if (p.clips.some(c => c.cutout) && !segmenterReady()) loadSegmenter().then(() => !this.playing && this.draw()).catch(() => {})
    if (p.clips.some(c => c.light) && !relightReady()) loadRelight().then(() => !this.playing && this.draw()).catch(() => {})
    this.project = p; this.prune(); if (!this.playing) this.seek(Math.min(this.time, projectDuration(p))) }

  seek(t: number) {
    this.time = Math.max(0, t)
    if (this.playing) { this.timeStart = this.time; this.clockStart = performance.now() }
    this.sync(false)
    this.draw()
    this.onTime(this.time)
  }

  play() {
    const end = projectDuration(this.project)
    if (!end) return
    if (this.time >= end - 0.05) this.time = 0
    // sound runs through Web Audio (needs a click to start), for volume above 100%, fades, voice enhancement and ducking
    this.audio ??= new AudioContext()
    this.audio.resume().catch(() => {})
    this.playing = true; this.timeStart = this.time; this.clockStart = performance.now()
    const loop = () => {
      if (!this.playing) return
      this.time = this.timeStart + (performance.now() - this.clockStart) / 1000
      if (this.time >= end) { this.time = end; this.pause(); this.draw(); this.onTime(end); return }
      this.sync(true); this.draw(); this.onTime(this.time)
      this.frame = requestAnimationFrame(loop)
    }
    loop()
  }

  pause() { this.playing = false; cancelAnimationFrame(this.frame); for (const el of this.els.values()) el.pause() }
  toggle() { if (this.playing) this.pause(); else this.play() }

  destroy() { this.pause(); this.audio?.close().catch(() => {}); for (const el of this.els.values()) { el.removeAttribute('src'); el.load() } this.els.clear() }

  draw() {
    const [W, H] = ASPECTS[this.project.aspect].map(v => Math.round(v * PREVIEW_SCALE))
    const c = this.canvas
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
    const g = c.getContext('2d')!
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    for (const clip of layersAt(this.project, this.time)) {
      if (clip.text) { drawTextClip(g, clip, W, H, this.time); continue }
      const asset = this.project.assets.find(a => a.id === clip.assetId)
      if (!asset) continue
      if (asset.kind === 'image' && asset.animated) {
        loadAnimation(asset.id, fileOf(asset.id)!, () => !this.playing && this.draw())
        const f = frameAt(asset.id, this.time - clip.start)
        if (f) drawClip(g, f, f.width, f.height, clip, W, H, this.time)
      } else if (asset.kind === 'image') {
        const img = this.image(asset.id)
        if (img.complete) drawClip(g, img, img.naturalWidth, img.naturalHeight, clip, W, H, this.time)
      } else if (asset.kind === 'video') {
        const v = this.el(clip, 'video') as HTMLVideoElement
        if (v.readyState >= 2) drawClip(g, v, v.videoWidth, v.videoHeight, clip, W, H, this.time)
      }
    }
  }

  private image(id: string) {
    let img = this.images.get(id)
    if (!img) { img = new Image(); img.src = urlOf(id); img.onload = () => !this.playing && this.draw(); this.images.set(id, img) }
    return img
  }

  private el(clip: Clip, kind: 'video' | 'audio') {
    let el = this.els.get(clip.id)
    if (!el) {
      el = document.createElement(kind)
      el.preload = 'auto'
      if (el instanceof HTMLVideoElement) el.playsInline = true
      el.src = urlOf(clip.assetId)
      el.addEventListener('seeked', () => !this.playing && this.draw())
      el.addEventListener('loadeddata', () => !this.playing && this.draw())
      this.els.set(clip.id, el)
    }
    return el
  }

  /** Puts every media element at the right moment, playing or paused */
  private sync(playing: boolean) {
    const t = this.time
    for (const clip of this.project.clips) {
      const asset = this.project.assets.find(a => a.id === clip.assetId)
      if (!asset || asset.kind === 'image') continue
      const track = this.project.tracks.find(tr => tr.id === clip.trackId)
      const el = this.el(clip, track?.kind === 'audio' || asset.kind === 'audio' ? 'audio' : 'video')
      const on = activeAt(clip, t) && !track?.hidden
      const want = sourceTime(clip, t)
      const route = asset.hasAudio ? this.route(clip, el) : null
      const level = track?.muted ? 0 : clipGainAt(clip, t)
      if (route) {
        el.muted = false; el.volume = 1
        route.gain.gain.value = level
        route.duck.gain.value = isMusicTrack(this.project, clip.trackId) ? envelopeAt(this.duckEnv, t) : 1
      } else { el.volume = Math.min(1, level); el.muted = level === 0 || !asset.hasAudio }
      el.playbackRate = clip.speed
      if (on && playing) {
        if (el.paused) { el.currentTime = want; el.play().catch(() => {}) }
        else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want
      } else {
        if (!el.paused) el.pause()
        // park clips at the frame they should show; clips about to start wait at their first frame
        const target = on ? want : t < clip.start && clip.start - t < 2 ? clip.in : null
        if (target !== null && Math.abs(el.currentTime - target) > 0.01 && (!playing || !on)) el.currentTime = target
      }
      if (clipEnd(clip) < t - 1 && !el.paused) el.pause()
    }
  }

  /** Connects a clip's element to Web Audio once, rebuilding the chain if voice enhancement is switched */
  private route(clip: Clip, el: HTMLMediaElement) {
    const ctx = this.audio
    if (!ctx) return null
    const enhance = { ...NO_AUDIO, ...clip.audio }.enhance
    let r = this.routes.get(clip.id)
    if (r && r.enhance === enhance) return r
    const src = r?.src ?? ctx.createMediaElementSource(el)
    if (r) { r.src.disconnect(); r.tail.disconnect() }
    const { out, gain } = clipChain(ctx, src, { ...clip, volume: 1 })
    const duck = ctx.createGain()
    out.connect(duck).connect(ctx.destination)
    r = { src, gain, duck, enhance, tail: duck }
    this.routes.set(clip.id, r)
    return r
  }

  /** Drops elements for clips that no longer exist */
  private prune() {
    for (const [id, el] of this.els) if (!this.project.clips.some(c => c.id === id)) { el.pause(); el.removeAttribute('src'); el.load(); this.els.delete(id); this.routes.get(id)?.tail.disconnect(); this.routes.delete(id) }
  }
}
