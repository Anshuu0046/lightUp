import { useEffect, useRef } from 'react'
import { Eye, EyeOff, Volume2, VolumeX } from 'lucide-react'
import { type Asset, type Clip, clipEnd, clipLength, collides, MIN_CLIP, projectDuration, type Project, type Track } from './model'

type Props = {
  project: Project
  time: number
  pps: number
  selected: string | null
  playing: boolean
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
  /** pinch to zoom on touch screens */
  onZoom: (pps: number) => void
  onDropAsset: (assetId: string, trackId: string, at: number) => void
  edit: { begin: () => void; live: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void; end: () => void; commit: (a: { type: 'setTrack'; id: string; patch: Partial<Track> }) => void }
}

const SNAP_PX = 8
const HEAD = 132
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

export function Timeline({ project, time, pps, selected, playing, onSelect, onSeek, onZoom, onDropAsset, edit }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const duration = projectDuration(project)
  const width = Math.max((duration + 12) * pps, 600)

  // keep the playhead in view while playing
  useEffect(() => {
    const s = scroller.current
    if (!s || !playing) return
    const x = time * pps
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = x - 60
  }, [time, pps, playing])

  // touch: one finger scrolls (the browser does that), two fingers pinch to zoom around the point between them
  const latest = useRef({ pps, onZoom }); latest.current = { pps, onZoom }
  useEffect(() => {
    const s = scroller.current!
    let pinch: { d: number; pps: number; t: number } | null = null
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    const middle = (e: TouchEvent) => (e.touches[0].clientX + e.touches[1].clientX) / 2 - s.getBoundingClientRect().left
    const start = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { d: spread(e), pps: latest.current.pps, t: (middle(e) + s.scrollLeft) / latest.current.pps } }
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const next = Math.min(300, Math.max(15, pinch.pps * spread(e) / pinch.d)), at = pinch.t * next - middle(e)
      latest.current.onZoom(next)
      requestAnimationFrame(() => { s.scrollLeft = at })
    }
    const end = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null }
    s.addEventListener('touchstart', start, { passive: true }); s.addEventListener('touchmove', move, { passive: false })
    s.addEventListener('touchend', end); s.addEventListener('touchcancel', end)
    return () => { s.removeEventListener('touchstart', start); s.removeEventListener('touchmove', move); s.removeEventListener('touchend', end); s.removeEventListener('touchcancel', end) }
  }, [])

  /** on touch, a drag is the browser scrolling the timeline, so only a tap (a press that barely moved) acts */
  const onTap = (e: React.PointerEvent, act: (ev: PointerEvent) => void) => {
    const x0 = e.clientX, y0 = e.clientY
    const off = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', off) }
    const up = (ev: PointerEvent) => { off(); if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) act(ev) }
    addEventListener('pointerup', up); addEventListener('pointercancel', off)
  }

  const timeAt = (clientX: number) => {
    const s = scroller.current!
    return Math.max(0, (clientX - s.getBoundingClientRect().left + s.scrollLeft) / pps)
  }

  const scrub = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(timeAt(e.clientX))
    const move = (ev: PointerEvent) => onSeek(timeAt(ev.clientX))
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }

  /** move or trim a clip; edges snap to other clips, the playhead and zero */
  const grab = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation()
    if (e.button !== 0) return
    // touch: the first tap selects; once selected, the clip can be dragged and trimmed
    if (e.pointerType === 'touch' && selected !== clip.id) return onTap(e, () => onSelect(clip.id))
    onSelect(clip.id)
    const asset = project.assets.find(a => a.id === clip.assetId)
    const x0 = e.clientX
    const edges = [0, time, ...project.clips.filter(c => c.id !== clip.id).flatMap(c => [c.start, clipEnd(c)])]
    const snap = (t: number) => { for (const s of edges) if (Math.abs(s - t) * pps < SNAP_PX) return s; return t }
    let started = false
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps
      if (!started) { if (Math.abs(ev.clientX - x0) < 3) return; started = true; edit.begin() }
      let patch: Partial<Clip>
      if (mode === 'move') {
        let start = Math.max(0, clip.start + dt)
        const len = clipLength(clip)
        const snappedEnd = snap(start + len)
        start = snap(start) !== start ? snap(start) : snappedEnd - len
        // dropping onto another track of the same kind moves it there
        const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-track]')
        const target = project.tracks.find(t => t.id === row?.dataset.track && t.kind === project.tracks.find(x => x.id === clip.trackId)?.kind)
        patch = { start: Math.max(0, start), trackId: target?.id ?? clip.trackId }
      } else if (mode === 'left') {
        const start = Math.min(snap(clip.start + dt), clipEnd(clip) - MIN_CLIP)
        const shift = (start - clip.start) * clip.speed
        // the keyframes stay on the same moments of the picture when the front of the clip moves
        const keys = clip.keys?.map(k => ({ ...k, t: k.t - (start - clip.start) }))
        if (clip.reverse) {
          // a reversed clip's front is the end of the file
          const out = clip.out - shift
          if (out > (asset?.duration ?? out) + 1e-6) return
          patch = { start, out, keys }
        } else {
          const inPoint = clip.in + shift
          if (inPoint < 0) return
          patch = { start, in: inPoint, keys }
        }
      } else {
        const end = Math.max(snap(clipEnd(clip) + dt), clip.start + MIN_CLIP)
        if (clip.reverse) patch = { in: Math.max(0, clip.out - (end - clip.start) * clip.speed) }
        else {
          const out = clip.in + (end - clip.start) * clip.speed
          // photos can be held as long as you like; video and audio stop at the end of the file
          patch = { out: !asset || asset.kind === 'image' ? out : Math.min(out, asset.duration) }
        }
      }
      if (!collides(project, { ...clip, ...patch })) edit.live({ type: 'updateClip', id: clip.id, patch })
    }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (started) edit.end() }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }

  const drop = (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData('application/x-lightup-asset')
    if (!id) return
    e.preventDefault()
    onDropAsset(id, track.id, timeAt(e.clientX))
  }

  const step = pps >= 120 ? 1 : pps >= 50 ? 2 : pps >= 25 ? 5 : 10
  const ticks = Array.from({ length: Math.ceil(width / pps / step) + 1 }, (_, i) => i * step)

  return <div className="timeline">
    <div className="tl-heads" style={{ width: HEAD }}>
      <div className="tl-ruler-spacer">{fmt(time)}</div>
      {project.tracks.map(t => <div key={t.id} className={`tl-head ${t.kind}`}>
        <span>{t.name}</span>
        {t.kind === 'visual'
          ? <button className="tl-icon" onClick={() => edit.commit({ type: 'setTrack', id: t.id, patch: { hidden: !t.hidden } })} aria-label={t.hidden ? 'Show track' : 'Hide track'} title={t.hidden ? 'Show track' : 'Hide track'}>{t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          : null}
        <button className="tl-icon" onClick={() => edit.commit({ type: 'setTrack', id: t.id, patch: { muted: !t.muted } })} aria-label={t.muted ? 'Unmute track' : 'Mute track'} title={t.muted ? 'Unmute track' : 'Mute track'}>{t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
      </div>)}
    </div>
    <div className="tl-scroll" ref={scroller}>
      <div className="tl-canvas" style={{ width }}>
        <div className="tl-ruler" onPointerDown={scrub}>
          {ticks.map(s => <span key={s} style={{ left: s * pps }}>{fmt(s).replace(/\.0$/, '')}</span>)}
        </div>
        {project.tracks.map(t => <div key={t.id} data-track={t.id} className={`tl-track ${t.kind} ${t.hidden ? 'hidden' : ''}`}
          onPointerDown={e => e.pointerType === 'touch' ? onTap(e, ev => { onSelect(null); onSeek(timeAt(ev.clientX)) }) : (onSelect(null), scrub(e))}
          onDragOver={e => e.dataTransfer.types.includes('application/x-lightup-asset') && e.preventDefault()} onDrop={e => drop(e, t)}>
          {project.clips.filter(c => c.trackId === t.id).map(c => <ClipView key={c.id} clip={c} asset={project.assets.find(a => a.id === c.assetId)} sound={t.kind === 'audio'} pps={pps} selected={selected === c.id} onGrab={grab} />)}
        </div>)}
        <div className="tl-playhead" style={{ left: time * pps }} />
      </div>
    </div>
  </div>
}

function ClipView({ clip, asset, sound, pps, selected, onGrab }: { clip: Clip; asset?: Asset; sound: boolean; pps: number; selected: boolean; onGrab: (e: React.PointerEvent, c: Clip, m: 'move' | 'left' | 'right') => void }) {
  if (clip.text) return <div className={`tl-clip text ${selected ? 'selected' : ''}`} style={{ left: clip.start * pps, width: Math.max(4, clipLength(clip) * pps) }} onPointerDown={e => onGrab(e, clip, 'move')} title={clip.text.content}>
    <i className="tl-trim left" onPointerDown={e => onGrab(e, clip, 'left')} />
    <span className="tl-label">T  {clip.text.content.replace(/\n/g, ' ')}</span>
    {clip.keys?.map((k, i) => <i key={i} className="tl-key" style={{ left: k.t * pps }} />)}
    <i className="tl-trim right" onPointerDown={e => onGrab(e, clip, 'right')} />
  </div>
  if (!asset) return null
  const style: React.CSSProperties = { left: clip.start * pps, width: Math.max(4, clipLength(clip) * pps) }
  if (sound && asset.wave) {
    // the whole file's waveform, stretched to the clip's speed and slid to its in-point
    style.backgroundImage = `url(${asset.wave}), linear-gradient(180deg, #2d5a4a, #1f3f35)`
    style.backgroundSize = `${(asset.duration * pps) / clip.speed}px 100%, 100% 100%`
    style.backgroundPosition = `${(-clip.in * pps) / clip.speed}px 0, 0 0`
    style.backgroundRepeat = 'no-repeat'
  } else if (!sound && asset.thumb) style.backgroundImage = `url(${asset.thumb})`
  return <div className={`tl-clip ${sound ? 'audio' : asset.kind} ${selected ? 'selected' : ''}`} style={style} onPointerDown={e => onGrab(e, clip, 'move')} title={asset.name}>
    <i className="tl-trim left" onPointerDown={e => onGrab(e, clip, 'left')} />
    <span className="tl-label">{clip.speed !== 1 && <b>{clip.speed}×</b>}{clip.reverse && <b>◀</b>}{clip.muted && <b>🔇</b>}{asset.name}</span>
    {clip.keys?.map((k, i) => <i key={i} className="tl-key" style={{ left: k.t * pps }} />)}
    <i className="tl-trim right" onPointerDown={e => onGrab(e, clip, 'right')} />
  </div>
}
