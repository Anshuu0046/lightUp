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
  onDropAsset: (assetId: string, trackId: string, at: number) => void
  edit: { begin: () => void; live: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void; end: () => void; commit: (a: { type: 'setTrack'; id: string; patch: Partial<Track> }) => void }
}

const SNAP_PX = 8
const HEAD = 132
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

export function Timeline({ project, time, pps, selected, playing, onSelect, onSeek, onDropAsset, edit }: Props) {
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
    onSelect(clip.id)
    const asset = project.assets.find(a => a.id === clip.assetId)!
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
        const inPoint = clip.in + shift
        if (inPoint < 0) return
        patch = { start, in: inPoint }
      } else {
        const end = Math.max(snap(clipEnd(clip) + dt), clip.start + MIN_CLIP)
        const out = clip.in + (end - clip.start) * clip.speed
        // photos can be held as long as you like; video and audio stop at the end of the file
        patch = { out: asset.kind === 'image' ? out : Math.min(out, asset.duration) }
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
          onPointerDown={e => { onSelect(null); scrub(e) }}
          onDragOver={e => e.dataTransfer.types.includes('application/x-lightup-asset') && e.preventDefault()} onDrop={e => drop(e, t)}>
          {project.clips.filter(c => c.trackId === t.id).map(c => <ClipView key={c.id} clip={c} asset={project.assets.find(a => a.id === c.assetId)} pps={pps} selected={selected === c.id} onGrab={grab} />)}
        </div>)}
        <div className="tl-playhead" style={{ left: time * pps }} />
      </div>
    </div>
  </div>
}

function ClipView({ clip, asset, pps, selected, onGrab }: { clip: Clip; asset?: Asset; pps: number; selected: boolean; onGrab: (e: React.PointerEvent, c: Clip, m: 'move' | 'left' | 'right') => void }) {
  if (!asset) return null
  const style: React.CSSProperties = { left: clip.start * pps, width: Math.max(4, clipLength(clip) * pps) }
  if (asset.thumb) style.backgroundImage = `url(${asset.thumb})`
  return <div className={`tl-clip ${asset.kind} ${selected ? 'selected' : ''}`} style={style} onPointerDown={e => onGrab(e, clip, 'move')} title={asset.name}>
    <i className="tl-trim left" onPointerDown={e => onGrab(e, clip, 'left')} />
    <span className="tl-label">{clip.speed !== 1 && <b>{clip.speed}×</b>}{asset.name}</span>
    <i className="tl-trim right" onPointerDown={e => onGrab(e, clip, 'right')} />
  </div>
}
