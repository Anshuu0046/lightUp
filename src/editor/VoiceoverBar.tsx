import { useEffect, useRef, useState } from 'react'
import { Circle, Mic, Square, X } from 'lucide-react'
import { Teleprompter, useScript } from '../Teleprompter'
import { encodeWav } from './audio'
import { denoise } from './denoise'

/**
 * Records your voice onto the timeline while the video plays, with the script scrolling for you to read.
 * The recording is saved as a clean WAV (browsers write recordings with no length, which timelines can't use).
 */
export function VoiceoverBar({ onBegin, onPlay, onPause, onDone, onClose }: { onBegin: () => void; onPlay: () => void; onPause: () => void; onDone: (file: File) => void; onClose: () => void }) {
  const { script, setScript, tele, setTele } = useScript()
  const [recording, setRecording] = useState(false)
  const [along, setAlong] = useState(true)
  const [clean, setClean] = useState(true)
  const [showScript, setShowScript] = useState(true)
  const cleanRef = useRef(true); cleanRef.current = clean
  const [editing, setEditing] = useState(!script.trim())
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState('')
  const rec = useRef<{ stop: () => void } | null>(null)
  useEffect(() => { if (!recording) return; setSecs(0); const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t) }, [recording])
  useEffect(() => () => rec.current?.stop(), [])

  const start = async () => {
    setError('')
    if (typeof MediaRecorder === 'undefined') return setError('Recording isn’t supported in this browser.')
    let mic: MediaStream
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }) }
    catch { return setError('Microphone access was blocked. Allow it and try again.') }
    const mr = new MediaRecorder(mic), chunks: Blob[] = []
    mr.ondataavailable = e => e.data.size && chunks.push(e.data)
    mr.onstop = async () => {
      mic.getTracks().forEach(t => t.stop())
      try {
        const blob = new Blob(chunks, { type: mr.mimeType })
        let buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer())
        if (cleanRef.current) buf = await denoise(buf, 'normal')
        onDone(new File([encodeWav(buf)], 'Voiceover.wav', { type: 'audio/wav' }))
      } catch { setError('Couldn’t read that recording. Try again.') }
    }
    rec.current = { stop: () => { if (mr.state !== 'inactive') mr.stop() } }
    onBegin(); mr.start(); setRecording(true)
    if (along) onPlay()
  }
  const stop = () => { rec.current?.stop(); rec.current = null; setRecording(false); onPause() }

  return <div className="vo-bar" role="dialog" aria-label="Voiceover">
    <div className="vo-head">
      <b><Mic size={14} /> Voiceover</b>
      <button className="ed-btn ghost small" onClick={() => { if (recording) stop(); onClose() }} aria-label="Close voiceover"><X size={15} /></button>
    </div>
    {!showScript ? null : editing && !recording
      ? <textarea className="ed-textarea" rows={4} autoFocus value={script} placeholder="Type or paste your script. It scrolls while you record." onChange={e => setScript(e.target.value)} />
      : <div className="vo-tele"><Teleprompter script={script} running={recording} speed={tele.speed} size={Math.min(tele.size, 30)} /></div>}
    <div className="vo-row">
      <button className="ed-btn small" onClick={() => setShowScript(v => !v)}>{showScript ? 'Hide script' : 'Show script'}</button>
      {showScript && !recording && <button className="ed-btn small" onClick={() => setEditing(e => !e)}>{editing ? 'Preview script' : 'Edit script'}</button>}
      <label className="ed-mini"><input type="checkbox" checked={clean} disabled={recording} onChange={e => setClean(e.target.checked)} /> Remove background noise</label>
      <label className="ed-mini"><input type="checkbox" checked={along} disabled={recording} onChange={e => setAlong(e.target.checked)} /> Play the video while I talk</label>
    </div>
    <div className="vo-row">
      {showScript ? <label className="ed-mini">Speed <input type="range" min="1" max="10" value={tele.speed} onChange={e => setTele({ speed: +e.target.value })} /></label> : <span />}
      {recording
        ? <button className="ed-btn danger" onClick={stop}><Square size={13} /> Stop {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</button>
        : <button className="ed-btn primary" onClick={start}><Circle size={13} /> Record from the playhead</button>}
    </div>
    {error ? <small className="ed-error">{error}</small> : <small className="ed-note">Wear headphones if the video has sound, so it doesn’t echo into your microphone.</small>}
  </div>
}
