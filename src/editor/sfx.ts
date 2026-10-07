import { encodeWav } from './audio'

/**
 * Built-in sound effects, synthesised on the device. Nothing is downloaded and nothing is licensed
 * from anyone, so creators can use them anywhere.
 */
type Recipe = { id: string; name: string; seconds: number; make: (ctx: OfflineAudioContext) => void }
const SR = 48000

function noise(ctx: OfflineAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(SR * seconds), SR), d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const s = ctx.createBufferSource(); s.buffer = b; return s
}
function env(ctx: OfflineAudioContext, at: number, attack: number, peak: number, decay: number) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay); return g
}
function tone(ctx: OfflineAudioContext, type: OscillatorType, f0: number, f1: number, at: number, len: number, peak: number) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + len)
  const g = env(ctx, at, 0.004, peak, len); o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + len + 0.05)
}
function hiss(ctx: OfflineAudioContext, at: number, len: number, f0: number, f1: number, peak: number, attack = 0.01, q = 1.2) {
  const n = noise(ctx, len + 0.1), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q
  bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + len)
  const g = env(ctx, at, attack, peak, len); n.connect(bp).connect(g).connect(ctx.destination); n.start(at); n.stop(at + len + 0.1)
}

export const SFX: Recipe[] = [
  { id: 'whoosh', name: 'Whoosh', seconds: 0.8, make: c => { const n = noise(c, 0.8), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5; bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(2800, 0.35); bp.frequency.exponentialRampToValueAtTime(500, 0.75); const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.9, 0.32); g.gain.linearRampToValueAtTime(0, 0.78); n.connect(bp).connect(g).connect(c.destination); n.start() } },
  { id: 'swoosh', name: 'Swoosh fast', seconds: 0.4, make: c => hiss(c, 0, 0.35, 900, 4000, 0.8, 0.12, 0.9) },
  { id: 'pop', name: 'Pop', seconds: 0.2, make: c => tone(c, 'sine', 900, 180, 0, 0.12, 0.9) },
  { id: 'bubble', name: 'Bubble', seconds: 0.3, make: c => tone(c, 'sine', 300, 1200, 0, 0.18, 0.7) },
  { id: 'click', name: 'Click', seconds: 0.1, make: c => hiss(c, 0, 0.02, 3000, 2500, 1, 0.001, 0.8) },
  { id: 'ding', name: 'Ding', seconds: 1.6, make: c => { tone(c, 'sine', 1320, 1318, 0, 1.4, 0.55); tone(c, 'sine', 2640, 2636, 0, 0.8, 0.2); tone(c, 'sine', 3960, 3955, 0, 0.4, 0.08) } },
  { id: 'notify', name: 'Notification', seconds: 0.7, make: c => { tone(c, 'sine', 880, 878, 0, 0.25, 0.5); tone(c, 'sine', 1320, 1318, 0.14, 0.45, 0.5) } },
  { id: 'success', name: 'Success', seconds: 1, make: c => [523, 659, 784, 1046].forEach((f, i) => tone(c, 'triangle', f, f, i * 0.09, 0.5, 0.35)) },
  { id: 'error', name: 'Wrong buzzer', seconds: 0.6, make: c => { tone(c, 'square', 160, 150, 0, 0.5, 0.25); tone(c, 'square', 120, 112, 0, 0.5, 0.2) } },
  { id: 'boom', name: 'Boom', seconds: 2, make: c => { tone(c, 'sine', 70, 30, 0, 1.6, 1); const n = noise(c, 0.6), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; const g = env(c, 0, 0.005, 0.8, 0.5); n.connect(lp).connect(g).connect(c.destination); n.start() } },
  { id: 'drop', name: 'Bass drop', seconds: 1.4, make: c => tone(c, 'sine', 160, 38, 0, 1.2, 1) },
  { id: 'riser', name: 'Riser', seconds: 2.5, make: c => { const n = noise(c, 2.5), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(6000, 2.4); const g = c.createGain(); g.gain.setValueAtTime(0.02, 0); g.gain.exponentialRampToValueAtTime(0.8, 2.35); g.gain.linearRampToValueAtTime(0, 2.5); n.connect(bp).connect(g).connect(c.destination); n.start(); const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(880, 2.4); const og = c.createGain(); og.gain.setValueAtTime(0.001, 0); og.gain.exponentialRampToValueAtTime(0.18, 2.35); og.gain.linearRampToValueAtTime(0, 2.5); o.connect(og).connect(c.destination); o.start(); o.stop(2.5) } },
  { id: 'shutter', name: 'Camera shutter', seconds: 0.4, make: c => { hiss(c, 0, 0.04, 2500, 1800, 1, 0.001, 0.7); hiss(c, 0.11, 0.06, 1800, 1200, 0.8, 0.001, 0.7) } },
  { id: 'scratch', name: 'Record scratch', seconds: 0.6, make: c => { hiss(c, 0, 0.25, 600, 2500, 0.8, 0.01, 4); hiss(c, 0.25, 0.3, 2500, 400, 0.8, 0.01, 4) } },
  { id: 'heartbeat', name: 'Heartbeat', seconds: 1.2, make: c => { tone(c, 'sine', 70, 45, 0, 0.18, 1); tone(c, 'sine', 65, 42, 0.24, 0.2, 0.8) } },
  { id: 'typing', name: 'Typing', seconds: 1.5, make: c => { for (let i = 0; i < 12; i++) hiss(c, i * 0.11 + Math.random() * 0.04, 0.015, 3500 + Math.random() * 1500, 3000, 0.6 + Math.random() * 0.3, 0.001, 1) } },
  { id: 'glitch', name: 'Glitch', seconds: 0.5, make: c => { for (let i = 0; i < 6; i++) tone(c, 'square', 200 + Math.random() * 1800, 100 + Math.random() * 900, i * 0.07, 0.05, 0.25) } },
  { id: 'magic', name: 'Sparkle', seconds: 1.4, make: c => { for (let i = 0; i < 10; i++) tone(c, 'sine', 1800 + i * 220, 1800 + i * 220, i * 0.06, 0.6, 0.12) } },
]

const cache = new Map<string, File>()

/** Renders an effect to a WAV file, once */
export async function sfxFile(id: string): Promise<File> {
  const hit = cache.get(id)
  if (hit) return hit
  const r = SFX.find(x => x.id === id)!
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * r.seconds), SR)
  r.make(ctx)
  const f = new File([encodeWav(await ctx.startRendering())], `${r.name}.wav`, { type: 'audio/wav' })
  cache.set(id, f)
  return f
}

let previewing: AudioBufferSourceNode | null = null
let previewCtx: AudioContext | null = null
/** Plays an effect once, for auditioning in the library */
export async function previewSfx(id: string) {
  previewCtx ??= new AudioContext()
  previewing?.stop()
  const buf = await previewCtx.decodeAudioData(await (await sfxFile(id)).arrayBuffer())
  const s = previewCtx.createBufferSource(); s.buffer = buf; s.connect(previewCtx.destination); s.start()
  previewing = s
}
