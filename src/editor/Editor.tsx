import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Film, Image as ImageIcon, Music, Pause, Play, Plus, Redo2, Scissors, SkipBack, Trash2, Type, Undo2, Upload, X } from 'lucide-react'
import { type Asset, ASPECTS, type Aspect, clipFor, clipLength, freeSpot, newProject, projectDuration, textClip, trackKindFor, uid } from './model'
import { BASE_TEXT, ensureFont } from './text'
import { layersAt } from './render'
import { useHistory } from './history'
import { clearSaved, importFile, loadProject, saveProject } from './media'
import { Player } from './player'
import { Timeline } from './Timeline'
import { Inspector } from './Inspector'
import './editor.css'

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`
const FRAME = 1 / 30

export default function Editor() {
  const h = useHistory(newProject())
  const { project } = h
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<Player | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [pps, setPps] = useState(60)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState('')
  const [exporting, setExporting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [panel, setPanel] = useState<'media' | 'edit' | null>(null) // phones show at most one side panel, so the preview gets the room
  const fileInput = useRef<HTMLInputElement>(null)
  const clip = project.clips.find(c => c.id === selected) ?? null
  const asset = clip ? project.assets.find(a => a.id === clip.assetId) : undefined
  const duration = projectDuration(project)

  // open the last project, then keep saving it
  useEffect(() => { loadProject().then(p => { if (p) h.reset(p); setLoaded(true) }) }, [])
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => saveProject(project).catch(() => setToast('Couldn’t save this project on this device.')), 600)
    return () => clearTimeout(t)
  }, [project, loaded])

  useEffect(() => {
    const p = new Player(canvas.current!, project)
    p.onTime = t => { setTime(t); setPlaying(p.playing) }
    player.current = p
    return () => p.destroy()
  }, [])
  useEffect(() => { player.current?.setProject(project) }, [project])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const seek = useCallback((t: number) => player.current?.seek(Math.min(t, Math.max(duration, 0))), [duration])
  const toggle = () => { player.current?.toggle(); setPlaying(!!player.current?.playing) }

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    setBusy(`Importing ${list.length} file${list.length > 1 ? 's' : ''}…`)
    for (const f of list) {
      try { h.commit({ type: 'addAsset', asset: await importFile(f) }) }
      catch (e) { setToast(e instanceof Error ? e.message : 'That file couldn’t be imported.') }
    }
    setBusy('')
  }

  const place = (a: Asset, trackId?: string, at?: number) => {
    const kind = trackKindFor(a.kind)
    const track = project.tracks.find(t => t.id === trackId && t.kind === kind) ?? project.tracks.find(t => t.kind === kind && (kind === 'audio' || t.id === 'v1')) ?? project.tracks.find(t => t.kind === kind)!
    const clipNew = clipFor(a, track.id, at ?? 0)
    if (a.kind === 'image' && track.id !== 'v1') clipNew.transform = { ...clipNew.transform, scale: 0.45 } // overlays start small
    // a click adds to the end of the track; a drop lands where it was dropped, or the next free gap
    h.commit({ type: 'addClip', clip: clipNew, fit: at === undefined ? 'append' : 'near' })
    setSelected(clipNew.id)
  }

  const split = () => {
    const target = clip && time > clip.start && time < clip.start + clipLength(clip) ? clip : project.clips.find(c => time > c.start && time < c.start + clipLength(c) && project.tracks.find(t => t.id === c.trackId)?.id === 'v1')
    if (!target) { setToast('Move the playhead over a clip to split it.'); return }
    h.commit({ type: 'split', id: target.id, at: time })
  }
  const addText = () => {
    const track = project.tracks.find(t => t.id === 't1') ?? project.tracks.find(t => t.kind === 'visual')!
    const c = textClip({ ...BASE_TEXT }, track.id, time)
    h.commit({ type: 'addClip', clip: c, fit: 'near' })
    setSelected(c.id); setPanel('edit')
    ensureFont(BASE_TEXT).then(() => player.current?.seek(player.current.time))
  }
  // drag on the preview to move the selected layer (or the top one); a plain click plays and pauses
  const dragOnPreview = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY
    const onTop = layersAt(project, time)
    const target = clip && onTop.some(c => c.id === clip.id) ? clip : onTop[onTop.length - 1]
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5 || !target) return; moved = true; h.begin(); setSelected(target.id) }
      const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height
      h.live({ type: 'updateClip', id: target!.id, patch: { transform: { ...target!.transform, x: target!.transform.x + dx, y: target!.transform.y + dy } } })
    }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) h.end(); else toggle() }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const remove = () => { if (selected) { h.commit({ type: 'removeClips', ids: [selected] }); setSelected(null) } }
  const duplicate = () => {
    if (!clip) return
    const copy = { ...clip, id: uid(), start: freeSpot(project, clip.trackId, clip.start + clipLength(clip), clipLength(clip)) }
    h.commit({ type: 'addClip', clip: copy }); setSelected(copy.id)
  }

  // keyboard: space play, S split, delete, ctrl+z / ctrl+shift+z, arrows step a frame
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest?.('input, select, textarea, [contenteditable]')) return
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey
      if (k === ' ') { e.preventDefault(); toggle() }
      else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) h.redo(); else h.undo() }
      else if (mod && k === 'y') { e.preventDefault(); h.redo() }
      else if (mod && k === 'd') { e.preventDefault(); duplicate() }
      else if (k === 's' && !mod) split()
      else if (k === 't' && !mod) { e.preventDefault(); addText() }
      else if (k === 'delete' || k === 'backspace') remove()
      else if (k === 'arrowleft') seek(time - (e.shiftKey ? 1 : FRAME))
      else if (k === 'arrowright') seek(time + (e.shiftKey ? 1 : FRAME))
      else if (k === 'home') seek(0)
    }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  })

  const newOne = async () => {
    if (project.clips.length && !confirm('Start a new project? The current one will be cleared from this device.')) return
    player.current?.pause(); await clearSaved(); h.reset(newProject()); setSelected(null); seek(0)
  }

  return <div className="editor" onDragOver={e => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files) } }}>
    <header className="ed-top">
      <a className="ed-btn ghost" href="#" aria-label="Home"><ArrowLeft size={16} /></a>
      <input className="ed-name" value={project.name} onChange={e => h.live({ type: 'rename', name: e.target.value })} aria-label="Project name" />
      <select className="ed-select" value={project.aspect} onChange={e => h.commit({ type: 'setAspect', aspect: e.target.value as Aspect })} aria-label="Frame shape">
        {(Object.keys(ASPECTS) as Aspect[]).map(a => <option key={a} value={a}>{a === '9:16' ? '9:16 Reels, Shorts, TikTok' : a === '16:9' ? '16:9 YouTube' : a === '1:1' ? '1:1 Square' : '4:5 Instagram post'}</option>)}
      </select>
      <span className="ed-spacer" />
      <button className="ed-btn ghost" onClick={h.undo} disabled={!h.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
      <button className="ed-btn ghost" onClick={h.redo} disabled={!h.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>
      <button className="ed-btn ghost wide-only" onClick={newOne}>New</button>
      <button className="ed-btn primary" onClick={() => setExporting(true)} disabled={!duration}><Download size={15} /> Export</button>
    </header>

    <div className="ed-main">
      <aside className={`ed-side media ${panel === 'media' ? 'show' : ''}`}>
        <div className="ed-side-head"><b>Media</b><button className="ed-btn small" onClick={() => fileInput.current?.click()}><Upload size={14} /> Import</button></div>
        <input ref={fileInput} type="file" multiple accept="video/*,image/*,audio/*" hidden onChange={e => { addFiles(e.target.files ?? []); e.target.value = '' }} />
        {project.assets.length === 0
          ? <button className="ed-empty" onClick={() => fileInput.current?.click()}><Upload size={22} /><b>Add your clips, photos and music</b><small>Or drop files anywhere in the editor</small></button>
          : <div className="ed-assets">{project.assets.map(a => <div key={a.id} className="ed-asset" draggable onDragStart={e => { e.dataTransfer.setData('application/x-lightup-asset', a.id); e.dataTransfer.effectAllowed = 'copy' }}>
              <div className="ed-thumb" style={a.thumb ? { backgroundImage: `url(${a.thumb})` } : undefined}>{a.kind === 'audio' && <Music size={20} />}<span>{a.kind === 'image' ? <ImageIcon size={11} /> : a.kind === 'video' ? <Film size={11} /> : <Music size={11} />}{a.kind !== 'image' && fmt(a.duration)}</span></div>
              <small title={a.name}>{a.name}</small>
              <button className="ed-add" onClick={() => place(a)} aria-label={`Add ${a.name} to the timeline`}><Plus size={14} /></button>
              <button className="ed-del" onClick={() => h.commit({ type: 'removeAsset', id: a.id })} aria-label={`Remove ${a.name}`}><X size={12} /></button>
            </div>)}</div>}
        {busy && <p className="ed-busy">{busy}</p>}
      </aside>

      <section className="ed-stage">
        <div className="ed-preview" style={{ aspectRatio: ASPECTS[project.aspect].join(' / ') }}>
          <canvas ref={canvas} onPointerDown={dragOnPreview} />
          {!project.clips.length && <div className="ed-hint">Add media, then press <b>+</b> or drag it onto the timeline</div>}
        </div>
        <div className="ed-transport">
          <button className="ed-btn ghost" onClick={() => seek(0)} aria-label="Back to start"><SkipBack size={16} /></button>
          <button className="ed-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <span className="ed-time">{fmt(time)} <small>/ {fmt(duration)}</small></span>
        </div>
      </section>

      <aside className={`ed-side inspector ${panel === 'edit' ? 'show' : ''}`}>
        {clip && (asset || clip.text) ? <>
          <Inspector key={clip.id} project={project} clip={clip} asset={asset} edit={h} onSplit={split} onDuplicate={duplicate} onRemove={remove} onError={setToast} />
        </> : <div className="ed-nothing"><b>Nothing selected</b><small>Click a clip on the timeline to adjust it, give it a look, or add effects.</small></div>}
      </aside>
    </div>

    <nav className="ed-tabs">
      <button className={panel === 'media' ? 'on' : ''} onClick={() => setPanel(p => (p === 'media' ? null : 'media'))}>Media</button>
      <button className={panel === 'edit' ? 'on' : ''} onClick={() => setPanel(p => (p === 'edit' ? null : 'edit'))}>Adjust</button>
    </nav>

    <div className="ed-tools">
      <button className="ed-btn small" onClick={split} title="Split at playhead (S)"><Scissors size={14} /> Split</button>
      <button className="ed-btn small" onClick={remove} disabled={!selected} title="Delete (Del)"><Trash2 size={14} /> Delete</button>
      <button className="ed-btn small" onClick={addText} title="Add text (T)"><Type size={14} /> Text</button>
      <button className="ed-btn small wide-only" onClick={() => h.commit({ type: 'addTrack', kind: 'visual' })}><Plus size={14} /> Overlay track</button>
      <button className="ed-btn small wide-only" onClick={() => h.commit({ type: 'addTrack', kind: 'audio' })}><Plus size={14} /> Audio track</button>
      <span className="ed-spacer" />
      <label className="ed-zoom">Zoom<input type="range" min={15} max={300} value={pps} onChange={e => setPps(+e.target.value)} /></label>
    </div>
    <Timeline project={project} time={time} pps={pps} selected={selected} playing={playing}
      onSelect={id => { setSelected(id); if (id) setPanel('edit') }} onSeek={seek}
      onDropAsset={(id, trackId, at) => { const a = project.assets.find(x => x.id === id); if (a) place(a, trackId, at) }}
      edit={h} />

    {exporting && <ExportDialog onClose={() => setExporting(false)} project={project} />}
    {toast && <div className="ed-toast" role="status">{toast}</div>}
  </div>
}


function ExportDialog({ project, onClose }: { project: ReturnType<typeof newProject>; onClose: () => void }) {
  const [height, setHeight] = useState<720 | 1080>(1080)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<{ url: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => { abort.current?.abort(); if (result) URL.revokeObjectURL(result.url) }, [result])

  const run = async () => {
    setError(''); setProgress(0)
    abort.current = new AbortController()
    try {
      const { exportVideo } = await import('./exporter')
      const blob = await exportVideo(project, { height, fps: 30 }, setProgress, abort.current.signal)
      const ext = blob.type.includes('webm') ? 'webm' : 'mp4'
      setResult({ url: URL.createObjectURL(blob), name: `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'video'}.${ext}` })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Export failed.')
    } finally { setProgress(null) }
  }

  return <div className="ed-modal-back" onMouseDown={() => progress === null && onClose()}>
    <div className="ed-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Export">
      <h2>Export video</h2>
      {result ? <>
        <p>Your video is ready.</p>
        <a className="ed-btn primary block" href={result.url} download={result.name}><Download size={15} /> Save {result.name}</a>
        <button className="ed-btn block" onClick={onClose}>Back to editing</button>
      </> : progress !== null ? <>
        <p>Rendering every frame… keep this tab open.</p>
        <div className="ed-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="ed-pct">{Math.round(progress * 100)}%</p>
        <button className="ed-btn block" onClick={() => abort.current?.abort()}>Cancel</button>
      </> : <>
        <p>{project.aspect} · {fmt(projectDuration(project))} · 30 fps</p>
        <div className="ed-chips big">{([720, 1080] as const).map(v => <button key={v} className={height === v ? 'on' : ''} onClick={() => setHeight(v)}>{v}p{v === 1080 ? ' (best)' : ' (faster)'}</button>)}</div>
        {error && <p className="ed-error">{error}</p>}
        <button className="ed-btn primary block" onClick={run}><Download size={15} /> Export</button>
        <button className="ed-btn block" onClick={onClose}>Cancel</button>
      </>}
    </div>
  </div>
}
