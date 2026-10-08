/**
 * Background-noise removal by spectral subtraction. The noise is learned from the quietest moments of the sound
 * (hiss, fans, room tone), then taken out of every frame, keeping a little of it so speech doesn't turn watery.
 */
const N = 2048, HOP = N / 4, BINS = N / 2 + 1

export type Strength = 'gentle' | 'normal' | 'strong'
const SETTINGS: Record<Strength, { over: number; floor: number }> = {
  gentle: { over: 1.5, floor: 0.2 },
  normal: { over: 2.2, floor: 0.12 },
  strong: { over: 3.2, floor: 0.07 },
}

const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2)
for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N) }
const rev = new Uint16Array(N)
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r }
/** sqrt-Hann: used going in and coming out, so the overlapped frames add back to the original */
const win = new Float32Array(N)
for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))

/** In-place FFT (inverse when `inv`), on separate real and imaginary arrays */
function fft(re: Float32Array, im: Float32Array, inv: boolean) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = inv ? -sin[k * step] : sin[k * step]
        const a = start + k, b = a + half
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
      }
    }
  }
}

const tick = () => new Promise<void>(r => setTimeout(r, 0))

async function cleanChannel(x: Float32Array, st: { over: number; floor: number }, onShare: (s: number) => void): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil((x.length + N) / HOP))
  const re = new Float32Array(N), im = new Float32Array(N)
  const load = (f: number) => { const o = f * HOP - N + HOP; for (let i = 0; i < N; i++) { const v = o + i; re[i] = v >= 0 && v < x.length ? x[v] * win[i] : 0; im[i] = 0 } }

  // the quietest tenth of the frames are taken to be "nothing but noise"
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) { let e = 0; const o = f * HOP - N + HOP; for (let i = 0; i < N; i += 4) { const v = o + i; if (v >= 0 && v < x.length) e += x[v] * x[v] } energy[f] = e }
  const order = [...energy.keys()].sort((a, b) => energy[a] - energy[b])
  const quiet = order.slice(0, Math.min(300, Math.max(4, Math.floor(frames * 0.1))))
  const noise = new Float32Array(BINS)
  for (const f of quiet) { load(f); fft(re, im, false); for (let k = 0; k < BINS; k++) noise[k] += Math.hypot(re[k], im[k]) / quiet.length }

  const out = new Float32Array(x.length), gain = new Float32Array(BINS).fill(1), raw = new Float32Array(BINS)
  for (let f = 0; f < frames; f++) {
    load(f); fft(re, im, false)
    for (let k = 0; k < BINS; k++) { const m = Math.hypot(re[k], im[k]); raw[k] = m < 1e-9 ? 1 : Math.max(st.floor, 1 - (st.over * noise[k]) / m) }
    // smooth across pitch (no isolated "bubbling" bins) and across time (opens fast, closes slowly)
    for (let k = 0; k < BINS; k++) {
      const g = (raw[Math.max(0, k - 1)] + raw[k] * 2 + raw[Math.min(BINS - 1, k + 1)]) / 4
      gain[k] = g > gain[k] ? g : gain[k] * 0.6 + g * 0.4
    }
    for (let k = 0; k < BINS; k++) { re[k] *= gain[k]; im[k] *= gain[k] }
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k] }
    fft(re, im, true)
    const o = f * HOP - N + HOP
    for (let i = 0; i < N; i++) { const v = o + i; if (v >= 0 && v < out.length) out[v] += (re[i] / N) * win[i] * 0.5 }
    if (f % 200 === 0) { onShare(f / frames); await tick() }
  }
  return out
}

/** A cleaned copy of the sound (same length and channels) */
export async function denoise(buf: AudioBuffer, strength: Strength, onProgress: (share: number) => void = () => {}): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate)
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const cleaned = await cleanChannel(buf.getChannelData(c), SETTINGS[strength], s => onProgress((c + s) / buf.numberOfChannels))
    out.getChannelData(c).set(cleaned)
  }
  onProgress(1)
  return out
}
