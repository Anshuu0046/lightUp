import { useEffect, useRef, useState } from 'react'
import { Eraser, Paintbrush, Sparkles } from 'lucide-react'
import type { Asset } from './model'
import { urlOf } from './media'
import { loadSegmenter, personMask } from './segment'

const MAX = 2048

/**
 * Refine a photo's cut-out by hand: start from the automatic mask, then paint to erase or restore.
 * Applying makes a new transparent PNG, so the original photo is never changed.
 */
export function CutoutEditor({ asset, onApply, onClose }: { asset: Asset; onApply: (file: File) => void; onClose: () => void }) {
  const view = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const mask = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'erase' | 'restore'>('erase')
  const [size, setSize] = useState(40)
  const [status, setStatus] = useState('Finding the person…')

  const redraw = () => {
    const v = view.current, i = img.current, m = mask.current
    if (!v || !i || !m) return
    const g = v.getContext('2d')!
    g.clearRect(0, 0, v.width, v.height)
    g.globalCompositeOperation = 'source-over'; g.drawImage(i, 0, 0, v.width, v.height)
    g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0, v.width, v.height)
    g.globalCompositeOperation = 'source-over'
  }

  const auto = async () => {
    const i = img.current, m = mask.current
    if (!i || !m) return
    setStatus('Finding the person…')
    const g = m.getContext('2d')!
    try {
      await loadSegmenter()
      const auto = personMask(i, `refine:${asset.id}:${Date.now()}`, 0.5, 0.25)
      g.globalCompositeOperation = 'copy'
      if (auto) g.drawImage(auto, 0, 0, m.width, m.height); else { g.fillStyle = '#fff'; g.fillRect(0, 0, m.width, m.height) }
      g.globalCompositeOperation = 'source-over'
      setStatus(auto ? '' : 'No person found. Paint with Restore to choose what to keep.')
    } catch { g.fillStyle = '#fff'; g.fillRect(0, 0, m.width, m.height); setStatus('Automatic cut-out isn’t available. Paint to erase the background.') }
    redraw()
  }

  useEffect(() => {
    const i = new Image()
    i.onload = () => {
      img.current = i
      const s = Math.min(1, MAX / Math.max(i.naturalWidth, i.naturalHeight))
      const m = document.createElement('canvas'); m.width = Math.round(i.naturalWidth * s); m.height = Math.round(i.naturalHeight * s); mask.current = m
      const v = view.current!, fit = Math.min(1, 560 / Math.max(m.width, m.height))
      v.width = Math.round(m.width * fit); v.height = Math.round(m.height * fit)
      auto()
    }
    i.src = urlOf(asset.id)
  }, [asset.id])

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!(e.buttons & 1) || !mask.current) return
    const v = e.currentTarget, box = v.getBoundingClientRect(), m = mask.current
    const x = ((e.clientX - box.left) / box.width) * m.width, y = ((e.clientY - box.top) / box.height) * m.height
    const r = (size / box.width) * m.width
    const g = m.getContext('2d')!
    const soft = g.createRadialGradient(x, y, r * 0.5, x, y, r)
    soft.addColorStop(0, 'rgba(255,255,255,1)'); soft.addColorStop(1, 'rgba(255,255,255,0)')
    g.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    g.fillStyle = soft; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    g.globalCompositeOperation = 'source-over'
    redraw()
  }

  const apply = () => {
    const i = img.current, m = mask.current
    if (!i || !m) return
    const out = document.createElement('canvas'); out.width = m.width; out.height = m.height
    const g = out.getContext('2d')!
    g.drawImage(i, 0, 0, out.width, out.height)
    g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0)
    out.toBlob(b => { if (b) onApply(new File([b], `${asset.name} cutout.png`, { type: 'image/png' })) }, 'image/png')
  }

  return <div className="ed-modal-back" onMouseDown={onClose}>
    <div className="ed-modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Refine cut-out">
      <h2>Refine cut-out</h2>
      <p>{status || 'Paint over the picture: Erase removes, Restore brings back.'}</p>
      <div className="ed-cut-stage"><canvas ref={view} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); paint(e) }} onPointerMove={paint} style={{ cursor: 'crosshair' }} /></div>
      <div className="ed-row">
        <div className="ed-chips">
          <button className={mode === 'erase' ? 'on' : ''} onClick={() => setMode('erase')}><Eraser size={13} /> Erase</button>
          <button className={mode === 'restore' ? 'on' : ''} onClick={() => setMode('restore')}><Paintbrush size={13} /> Restore</button>
          <button onClick={auto}><Sparkles size={13} /> Auto again</button>
        </div>
        <label className="ed-zoom">Brush<input type="range" min={6} max={120} value={size} onChange={e => setSize(+e.target.value)} /></label>
      </div>
      <button className="ed-btn primary block" onClick={apply}>Use this cut-out</button>
      <button className="ed-btn block" onClick={onClose}>Cancel</button>
    </div>
  </div>
}
