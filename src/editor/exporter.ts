import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat,
} from 'mediabunny'
import { activeAt, ASPECTS, type Clip, clipEnd, clipLength, projectDuration, type Project, sourceTime } from './model'
import { fileOf } from './media'
import { drawClip, drawTextClip, layersAt } from './render'
import { ensureFont } from './text'

export type ExportOptions = { height: 720 | 1080; fps: 30 | 60 }
const SAMPLE_RATE = 48000

/**
 * Renders the timeline frame by frame (not in real time, so nothing is ever dropped) and writes an MP4.
 * Video frames are decoded in order per clip, which is far faster than seeking for every frame.
 */
export async function exportVideo(p: Project, opts: ExportOptions, onProgress: (share: number) => void, signal: AbortSignal): Promise<Blob> {
  const duration = projectDuration(p)
  if (!duration) throw new Error('Add something to the timeline first.')
  const [baseW, baseH] = ASPECTS[p.aspect]
  const scale = opts.height / Math.min(baseW, baseH)
  const W = Math.round((baseW * scale) / 2) * 2, H = Math.round((baseH * scale) / 2) * 2

  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d')!

  // prefer MP4 (what every phone and platform takes); fall back to WebM where MP4 encoding is unavailable
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: 'in-memory' })
  let videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: W, height: H })
  if (!videoCodec) { format = new WebMOutputFormat(); videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: W, height: H }) }
  if (!videoCodec) throw new Error('This browser can’t encode video. Try Chrome or Edge.')
  const audioCodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), { numberOfChannels: 2, sampleRate: SAMPLE_RATE })

  const target = new BufferTarget()
  const output = new Output({ format, target })
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH })
  output.addVideoTrack(video, { frameRate: opts.fps })
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null
  if (audio) output.addAudioTrack(audio)
  await output.start()

  const inputs: Input[] = []
  try {
    const frames = Math.ceil(duration * opts.fps)
    const times = Array.from({ length: frames }, (_, i) => i / opts.fps)

    // one frame stream per video clip, asked only for the moments it is on screen
    const streams = new Map<string, AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>>()
    for (const clip of p.clips) {
      const asset = p.assets.find(a => a.id === clip.assetId)
      if (asset?.kind !== 'video') continue
      const input = new Input({ source: new BlobSource(fileOf(asset.id)!), formats: ALL_FORMATS }); inputs.push(input)
      const track = await input.getPrimaryVideoTrack()
      if (!track) continue
      const first = await track.getFirstTimestamp()
      const wanted = times.filter(t => activeAt(clip, t)).map(t => first + sourceTime(clip, t))
      streams.set(clip.id, new CanvasSink(track, { poolSize: 2 }).canvasesAtTimestamps(wanted))
    }
    for (const c of p.clips) if (c.text) await ensureFont(c.text)
    const images = new Map<string, ImageBitmap>()
    for (const a of p.assets) if (a.kind === 'image' && p.clips.some(c => c.assetId === a.id)) images.set(a.id, await createImageBitmap(fileOf(a.id)!))

    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const t = times[i]
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
      for (const clip of layersAt(p, t)) {
        if (clip.text) { drawTextClip(g, clip, W, H, t); continue }
        const asset = p.assets.find(a => a.id === clip.assetId)!
        if (asset.kind === 'image') { const b = images.get(asset.id)!; drawClip(g, b, b.width, b.height, clip, W, H, t) }
        else if (asset.kind === 'video') {
          const next = await streams.get(clip.id)?.next()
          const frame = next && !next.done ? next.value : null
          if (frame) drawClip(g, frame.canvas, frame.canvas.width, frame.canvas.height, clip, W, H, t)
        }
      }
      await video.add(t, 1 / opts.fps)
      onProgress((i / frames) * 0.9)
    }
    // clips hidden behind layers above them still consumed their frames, so nothing is left dangling
    for (const s of streams.values()) await s.return(undefined)

    if (audio) { await audio.add(await mixAudio(p, duration)); onProgress(0.97) }
    await output.finalize()
    onProgress(1)
    return new Blob([target.buffer!], { type: format.mimeType })
  } catch (e) {
    await output.cancel().catch(() => {})
    throw e
  } finally {
    inputs.forEach(i => i.dispose?.())
  }
}

/** Mixes every audible clip into one stereo track, at its place, speed and volume */
export async function mixAudio(p: Project, duration: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE)
  const decoded = new Map<string, AudioBuffer | null>()
  for (const clip of p.clips) {
    const asset = p.assets.find(a => a.id === clip.assetId)
    const track = p.tracks.find(t => t.id === clip.trackId)
    if (!asset || asset.kind === 'image' || !asset.hasAudio || track?.muted || track?.hidden || clip.volume <= 0) continue
    if (!decoded.has(asset.id)) {
      try { decoded.set(asset.id, await ctx.decodeAudioData(await fileOf(asset.id)!.arrayBuffer())) }
      catch { decoded.set(asset.id, null) } // a video with no audio track
    }
    const buffer = decoded.get(asset.id)
    if (!buffer) continue
    connect(ctx, buffer, clip)
  }
  return ctx.startRendering()
}

function connect(ctx: OfflineAudioContext, buffer: AudioBuffer, clip: Clip) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = clip.speed
  const gain = ctx.createGain()
  gain.gain.value = clip.volume
  src.connect(gain).connect(ctx.destination)
  src.start(clip.start, clip.in, clipLength(clip) * clip.speed)
  src.stop(clipEnd(clip))
}
