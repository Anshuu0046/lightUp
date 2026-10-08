/** The editor's document: media you imported, tracks, and clips placed on them. All times are in seconds. */
import type { Fx, Grade } from './looks'
import type { TextSpec } from './text'
import type { ClipAudio, Ducking } from './audio'
import type { Lighting } from './relight'
import type { EyeFx } from './eyes'
import type { ClipLut, CustomLut } from './lut'

export type AssetKind = 'video' | 'image' | 'audio'
export type Asset = { id: string; kind: AssetKind; name: string; duration: number; width: number; height: number; hasAudio: boolean; thumb: string; /** waveform picture for sound */ wave?: string; /** GIFs and animated stickers loop */ animated?: boolean }

export type TrackKind = 'visual' | 'audio'
export type Track = { id: string; kind: TrackKind; name: string; muted: boolean; hidden: boolean }

/** Where a visual clip sits in the frame: centre (0-1 of the canvas), scale (1 = fit), rotation in degrees */
export type Transform = { x: number; y: number; scale: number; rotation: number }

export type Clip = {
  id: string
  assetId: string
  trackId: string
  /** where the clip starts on the timeline */
  start: number
  /** which part of the source plays */
  in: number
  out: number
  speed: number
  volume: number
  opacity: number
  transform: Transform
  /** colour grade and effects; missing on clips saved before they existed */
  grade?: Grade
  fx?: Fx
  preset?: string
  /** set on text clips, which have no media file behind them */
  text?: TextSpec
  audio?: ClipAudio
  /** remove or blur the background behind a person */
  cutout?: Cutout
  /** crop the clip to a shape (picture-in-picture bubbles) */
  shape?: 'none' | 'rounded' | 'circle'
  /** studio light added to the filmed picture */
  light?: Lighting
  /** position, size, rotation and opacity over the clip's own time; when set, these replace `transform` and `opacity` */
  keys?: Keyframe[]
  /** plays backwards (sound too, in the export) */
  reverse?: boolean
  /** mirror left-right / flip upside down */
  flipX?: boolean
  flipY?: boolean
  /** the clip's own sound is removed (the file keeps it, so it can be brought back) */
  muted?: boolean
  /** colour lookup table on top of the grade */
  lut?: ClipLut
  /** glowing eyes, lightning eyes... tracked on the person's face */
  eyes?: EyeFx
}

/** t is seconds from the start of the clip on the timeline */
export type Keyframe = { t: number; x: number; y: number; scale: number; rotation: number; opacity: number }

export type Cutout = { mode: 'remove' | 'blur'; threshold: number; feather: number }

export type Aspect = '9:16' | '16:9' | '1:1' | '4:5'
export type Project = { name: string; aspect: Aspect; tracks: Track[]; clips: Clip[]; assets: Asset[]; ducking?: Ducking; /** .cube files the user imported */ luts?: CustomLut[] }

export const ASPECTS: Record<Aspect, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }
export const IMAGE_DEFAULT_SECONDS = 4
export const MIN_CLIP = 0.1

export const uid = () => crypto.randomUUID().slice(0, 8)

export function newProject(): Project {
  return {
    name: 'Untitled video', aspect: '9:16', assets: [], clips: [],
    tracks: [
      { id: 't1', kind: 'visual', name: 'Text', muted: false, hidden: false },
      { id: 'v2', kind: 'visual', name: 'Overlay', muted: false, hidden: false },
      { id: 'v1', kind: 'visual', name: 'Main', muted: false, hidden: false },
      { id: 'a1', kind: 'audio', name: 'Music', muted: false, hidden: false },
      { id: 'a2', kind: 'audio', name: 'Voice & SFX', muted: false, hidden: false },
    ],
  }
}

export const clipLength = (c: Clip) => (c.out - c.in) / c.speed
export const clipEnd = (c: Clip) => c.start + clipLength(c)
export const projectDuration = (p: Project) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
export const trackKindFor = (k: AssetKind): TrackKind => (k === 'audio' ? 'audio' : 'visual')
/** where in the source a timeline moment falls */
export const sourceTime = (c: Clip, t: number) => (c.reverse ? c.out - (t - c.start) * c.speed : c.in + (t - c.start) * c.speed)
export const activeAt = (c: Clip, t: number) => t >= c.start && t < clipEnd(c)

// ---------- edits ----------

export type Action =
  | { type: 'addAsset'; asset: Asset }
  | { type: 'removeAsset'; id: string }
  /** fit: 'append' puts it after the last clip on its track; 'near' takes the first free gap at or after clip.start */
  | { type: 'addClip'; clip: Clip; fit?: 'append' | 'near' }
  | { type: 'updateClip'; id: string; patch: Partial<Clip> }
  | { type: 'removeClips'; ids: string[] }
  | { type: 'split'; id: string; at: number }
  | { type: 'setTrack'; id: string; patch: Partial<Track> }
  | { type: 'addTrack'; kind: TrackKind }
  | { type: 'setAspect'; aspect: Aspect }
  | { type: 'rename'; name: string }
  | { type: 'load'; project: Project }
  /** replaces every clip on a track (adding the track on top if it's new), e.g. regenerated captions */
  | { type: 'replaceTrackClips'; track: Track; clips: Clip[] }
  | { type: 'setDucking'; ducking: Ducking }
  | { type: 'addLut'; lut: CustomLut }
  /** moves a video's sound onto its own clip on an audio track, so it can be edited separately */
  | { type: 'detachAudio'; id: string; trackId: string }

export function apply(p: Project, a: Action): Project {
  switch (a.type) {
    case 'addAsset': return { ...p, assets: [...p.assets, a.asset] }
    case 'removeAsset': return { ...p, assets: p.assets.filter(x => x.id !== a.id), clips: p.clips.filter(c => c.assetId !== a.id) }
    case 'addClip': {
      const len = clipLength(a.clip)
      const onTrack = p.clips.filter(c => c.trackId === a.clip.trackId)
      const from = a.fit === 'append' ? onTrack.reduce((m, c) => Math.max(m, clipEnd(c)), 0) : a.clip.start
      const start = a.fit ? freeSpot(p, a.clip.trackId, from, len) : a.clip.start
      return { ...p, clips: [...p.clips, { ...a.clip, start }] }
    }
    case 'updateClip': return { ...p, clips: p.clips.map(c => (c.id === a.id ? { ...c, ...a.patch } : c)) }
    case 'removeClips': return { ...p, clips: p.clips.filter(c => !a.ids.includes(c.id)) }
    case 'split': {
      const c = p.clips.find(x => x.id === a.id)
      if (!c || a.at <= c.start + MIN_CLIP || a.at >= clipEnd(c) - MIN_CLIP) return p
      const cut = sourceTime(c, a.at)
      const [ka, kb] = splitKeys(c, a.at - c.start)
      // a reversed clip plays its source from the end, so its first half on the timeline is the later part of the file
      const first: Clip = c.reverse ? { ...c, in: cut, keys: ka } : { ...c, out: cut, keys: ka }
      const second: Clip = c.reverse ? { ...c, id: uid(), start: a.at, out: cut, keys: kb } : { ...c, id: uid(), start: a.at, in: cut, keys: kb }
      return { ...p, clips: p.clips.flatMap(x => (x.id !== c.id ? [x] : [first, second])) }
    }
    case 'setTrack': return { ...p, tracks: p.tracks.map(t => (t.id === a.id ? { ...t, ...a.patch } : t)) }
    case 'addTrack': {
      const n = p.tracks.filter(t => t.kind === a.kind).length + 1
      const track: Track = { id: uid(), kind: a.kind, name: a.kind === 'visual' ? `Overlay ${n}` : `Audio ${n}`, muted: false, hidden: false }
      // new visual tracks go on top of the picture; new audio tracks go at the bottom
      return { ...p, tracks: a.kind === 'visual' ? [track, ...p.tracks] : [...p.tracks, track] }
    }
    case 'setAspect': return { ...p, aspect: a.aspect }
    case 'rename': return { ...p, name: a.name }
    case 'load': return a.project
    case 'setDucking': return { ...p, ducking: a.ducking }
    case 'addLut': return { ...p, luts: [...(p.luts ?? []), a.lut] }
    case 'detachAudio': {
      const c = p.clips.find(x => x.id === a.id)
      if (!c) return p
      const sound: Clip = { ...c, id: uid(), trackId: a.trackId, opacity: 1, grade: undefined, fx: undefined, preset: undefined }
      if (collides(p, sound)) return p
      return { ...p, clips: [...p.clips.map(x => (x.id === c.id ? { ...x, volume: 0 } : x)), sound] }
    }
    case 'replaceTrackClips': {
      const tracks = p.tracks.some(t => t.id === a.track.id) ? p.tracks : [a.track, ...p.tracks]
      return { ...p, tracks, clips: [...p.clips.filter(c => c.trackId !== a.track.id), ...a.clips] }
    }
  }
}

import { splitKeys } from './keyframes'

/** First moment on a track at or after `from` where a clip of `length` fits without overlapping anything */
export function freeSpot(p: Project, trackId: string, from: number, length: number): number {
  const others = p.clips.filter(c => c.trackId === trackId).sort((a, b) => a.start - b.start)
  let t = from
  for (const c of others) {
    if (t + length <= c.start) break
    if (clipEnd(c) > t) t = clipEnd(c)
  }
  return t
}

/** Clips that would overlap `c` if it were placed as given */
export const collides = (p: Project, c: Clip) =>
  p.clips.some(o => o.id !== c.id && o.trackId === c.trackId && c.start < clipEnd(o) - 1e-6 && clipEnd(c) > o.start + 1e-6)

export const TEXT_ASSET = 'text'
export const TEXT_SECONDS = 3

export function textClip(spec: TextSpec, trackId: string, start: number): Clip {
  return { id: uid(), assetId: TEXT_ASSET, trackId, start, in: 0, out: TEXT_SECONDS, speed: 1, volume: 0, opacity: 1, transform: { x: 0.5, y: 0.72, scale: 1, rotation: 0 }, text: spec }
}

export function clipFor(asset: Asset, trackId: string, start: number): Clip {
  const length = asset.kind === 'image' ? IMAGE_DEFAULT_SECONDS : asset.duration // photos and stickers (animated ones loop)
  return { id: uid(), assetId: asset.id, trackId, start, in: 0, out: length, speed: 1, volume: 1, opacity: 1, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 } }
}
