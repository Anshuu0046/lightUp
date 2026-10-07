import { type Clip, clipEnd, clipLength, type Project } from './model'

/** Per-clip sound settings; missing on clips saved before they existed */
export type ClipAudio = { fadeIn: number; fadeOut: number; enhance: boolean }
export const NO_AUDIO: ClipAudio = { fadeIn: 0, fadeOut: 0, enhance: false }
/** Project-wide: music dips under speech */
export type Ducking = { on: boolean; amount: number }
export const DEFAULT_DUCKING: Ducking = { on: false, amount: 0.7 }

export const isMusicTrack = (p: Project, trackId: string) => {
  const t = p.tracks.find(x => x.id === trackId)
  return !!t && t.kind === 'audio' && (t.id === 'a1' || /music/i.test(t.name))
}

type AnyCtx = BaseAudioContext

/**
 * "Enhance voice": the usual broadcast chain. Cut rumble, clear boxiness, lift presence,
 * then even the level out so quiet words don't get lost.
 */
export function voiceChain(ctx: AnyCtx, input: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 320; mud.Q.value = 1; mud.gain.value = -3
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 0.9; presence.gain.value = 3.5
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 2
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18
  const makeup = ctx.createGain(); makeup.gain.value = 1.6
  input.connect(hp).connect(mud).connect(presence).connect(air).connect(comp).connect(makeup)
  return makeup
}

// ---------- ducking: find where people talk, and dip the music there ----------

export const ENV_RATE = 20 // envelope samples per second

/**
 * From the speech-only mix (everything except music), a gain curve for the music:
 * 1 where nobody talks, (1 - amount) while they do, with a quick dip and a slow, smooth return.
 */
export function duckEnvelope(speech: AudioBuffer, amount: number): Float32Array {
  const data = speech.getChannelData(0)
  const hop = Math.round(speech.sampleRate / ENV_RATE)
  const n = Math.ceil(data.length / hop)
  const level = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const a = i * hop, b = Math.min(data.length, a + hop)
    for (let k = a; k < b; k++) s += data[k] * data[k]
    level[i] = Math.sqrt(s / Math.max(1, b - a))
  }
  const loud = [...level].sort((x, y) => x - y)[Math.floor(n * 0.95)] || 0
  const threshold = Math.max(0.01, loud * 0.12)
  const env = new Float32Array(n)
  let g = 1, hold = 0
  const low = 1 - amount
  for (let i = 0; i < n; i++) {
    if (level[i] > threshold) hold = Math.round(ENV_RATE * 0.35) // keep dipped through short gaps between words
    const target = hold-- > 0 ? low : 1
    g += (target - g) * (target < g ? 0.55 : 0.12) // down fast, up slowly
    env[i] = g
  }
  return env
}

export const envelopeAt = (env: Float32Array | null, t: number) => (env && env.length ? env[Math.min(env.length - 1, Math.max(0, Math.round(t * ENV_RATE)))] : 1)

// ---------- one clip's sound path, shared by preview and export ----------

/** Volume, fades and voice enhancement for one clip; returns the node to connect onward */
export function clipChain(ctx: AnyCtx, source: AudioNode, clip: Clip): { out: AudioNode; gain: GainNode } {
  const a = { ...NO_AUDIO, ...clip.audio }
  const gain = ctx.createGain()
  gain.gain.value = clip.volume
  let node: AudioNode = source.connect(gain)
  if (a.enhance) node = voiceChain(ctx, gain)
  return { out: node, gain }
}

/** Clip gain at timeline time t: its volume shaped by its fades (used to automate export and drive preview) */
export function clipGainAt(clip: Clip, t: number) {
  const a = { ...NO_AUDIO, ...clip.audio }
  const local = t - clip.start, len = clipLength(clip)
  let g = clip.volume
  if (a.fadeIn > 0) g *= Math.min(1, Math.max(0, local / a.fadeIn))
  if (a.fadeOut > 0) g *= Math.min(1, Math.max(0, (len - local) / a.fadeOut))
  return g
}

/** Writes the fades into an offline gain parameter */
export function automateFades(param: AudioParam, clip: Clip) {
  const a = { ...NO_AUDIO, ...clip.audio }
  const s = clip.start, e = clipEnd(clip), v = clip.volume
  param.setValueAtTime(a.fadeIn > 0 ? 0 : v, s)
  if (a.fadeIn > 0) param.linearRampToValueAtTime(v, s + Math.min(a.fadeIn, e - s))
  if (a.fadeOut > 0) { param.setValueAtTime(v, Math.max(s, e - a.fadeOut)); param.linearRampToValueAtTime(0, e) }
}

// ---------- files ----------

/** 16-bit PCM WAV, for sound effects and processed audio */
export function encodeWav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, n = b.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, b.sampleRate, true)
  out.setUint32(28, b.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, i) => b.getChannelData(i))
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 0x7fff, true)
  return new Blob([out.buffer], { type: 'audio/wav' })
}

/** A waveform picture of a whole file, drawn once on import and stretched under the clip */
export function waveImage(b: AudioBuffer): string {
  const W = Math.min(4000, Math.max(200, Math.round(b.duration * 40))), H = 48
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!, d = b.getChannelData(0), step = d.length / W
  g.fillStyle = 'rgba(170, 255, 215, .75)'
  for (let x = 0; x < W; x++) {
    let peak = 0
    for (let i = Math.floor(x * step), e = Math.floor((x + 1) * step); i < e; i += 8) peak = Math.max(peak, Math.abs(d[i]))
    const h = Math.max(1, Math.min(1, peak * 1.6) * H)
    g.fillRect(x, (H - h) / 2, 1, h)
  }
  return c.toDataURL('image/png')
}
