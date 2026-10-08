import { useEffect, useRef, useState } from 'react'
import './teleprompter.css'

export type Tele = { on: boolean; speed: number; size: number }
export const DEFAULT_TELE: Tele = { on: true, speed: 5, size: 30 }

/** The script and its settings, remembered on the device */
export function useScript() {
  const [script, setScript] = useState(() => { try { return localStorage.getItem('lightup-script') ?? '' } catch { return '' } })
  const [tele, setTele] = useState<Tele>(() => { try { return { ...DEFAULT_TELE, ...JSON.parse(localStorage.getItem('lightup-tele') || '{}') } } catch { return DEFAULT_TELE } })
  useEffect(() => { try { localStorage.setItem('lightup-script', script) } catch { /* private mode */ } }, [script])
  useEffect(() => { try { localStorage.setItem('lightup-tele', JSON.stringify(tele)) } catch { /* private mode */ } }, [tele])
  return { script, setScript, tele, setTele: (p: Partial<Tele>) => setTele(t => ({ ...t, ...p })) }
}

/**
 * A script that scrolls up by itself while `running` (start of a recording) at a reading pace, from the top each time.
 * Drag to move it by hand, tap to pause or resume.
 */
export function Teleprompter({ script, running, speed, size, className = '' }: { script: string; running: boolean; speed: number; size: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const offset = useRef(0)
  const drag = useRef<{ y: number; o: number; moved: boolean } | null>(null)
  const [paused, setPaused] = useState(false)
  const place = () => { if (text.current) text.current.style.transform = `translateY(${-offset.current}px)` }
  const limit = () => Math.max(0, (text.current?.scrollHeight ?? 0) - (box.current?.clientHeight ?? 0) * 0.45)

  useEffect(() => { if (running) { offset.current = 0; setPaused(false); place() } }, [running])
  useEffect(() => {
    if (!running || paused) return
    let raf = 0, last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now
      // about one line per 1.6 seconds at the middle setting, so a normal speaking pace
      if (!drag.current) { offset.current = Math.min(limit(), offset.current + dt * size * 0.168 * speed); place() }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, paused, speed, size])
  useEffect(() => { offset.current = Math.min(offset.current, limit()); place() }, [script, size])

  return <div ref={box} className={`tp ${running ? 'running' : ''} ${paused ? 'paused' : ''} ${className}`}
    onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, o: offset.current, moved: false } }}
    onPointerMove={e => { const d = drag.current; if (!d) return; const dy = d.y - e.clientY; if (Math.abs(dy) > 6) d.moved = true; if (d.moved) { offset.current = Math.min(limit(), Math.max(0, d.o + dy)); place() } }}
    onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved && running) setPaused(p => !p) }}
    onPointerCancel={() => { drag.current = null }}
    onWheel={e => { offset.current = Math.min(limit(), Math.max(0, offset.current + e.deltaY)); place() }}>
    <div ref={text} className="tp-text" style={{ fontSize: size }}>{script.trim() || 'Type or paste your script in the settings. It scrolls by itself while you record.'}</div>
    <i className="tp-line" aria-hidden />
    {paused && <span className="tp-paused">Paused · tap to continue</span>}
  </div>
}
