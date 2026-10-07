import { useState } from 'react'
import { Copy, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { type Asset, type Clip, collides, type Project } from './model'
import { type Fx, type Grade, NO_FX, NO_GRADE, PRESETS, thumbFilter } from './looks'

type Edit = {
  begin: () => void
  live: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
  end: () => void
  commit: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
}

type Props = { project: Project; clip: Clip; asset: Asset; edit: Edit; onSplit: () => void; onDuplicate: () => void; onRemove: () => void; onError: (m: string) => void }

/** A slider whose whole drag is one undo step */
function Range({ label, value, min, max, unit = '', step = 1, edit, onChange }: { label: string; value: number; min: number; max: number; unit?: string; step?: number; edit: Edit; onChange: (v: number) => void }) {
  return <label className="ed-field"><span>{label} <b>{value}{unit}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onPointerDown={edit.begin} onPointerUp={edit.end} onKeyDown={edit.begin} onKeyUp={edit.end} onChange={e => onChange(+e.target.value)} />
  </label>
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return <label className="ed-toggle"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} /><i /></label>
}

export function Inspector({ project, clip, asset, edit, onSplit, onDuplicate, onRemove, onError }: Props) {
  const visual = asset.kind !== 'audio'
  const [tab, setTab] = useState<'adjust' | 'look' | 'fx'>('adjust')
  const grade = { ...NO_GRADE, ...clip.grade }, fx = { ...NO_FX, ...clip.fx }
  const live = (patch: Partial<Clip>) => edit.live({ type: 'updateClip', id: clip.id, patch })
  const setGrade = (p: Partial<Grade>) => live({ grade: { ...grade, ...p }, preset: undefined })
  const setFx = (p: Partial<Fx>) => live({ fx: { ...fx, ...p } })
  const commit = (patch: Partial<Clip>) => {
    if (collides(project, { ...clip, ...patch })) { onError('That would overlap the next clip. Move it first.'); return }
    edit.commit({ type: 'updateClip', id: clip.id, patch })
  }
  const pct = (v: number) => Math.round(v * 100)

  return <>
    <div className="ed-side-head"><b title={asset.name}>{asset.name}</b></div>
    {visual && <div className="ed-segment" role="tablist">
      {(['adjust', 'look', 'fx'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'adjust' ? 'Adjust' : t === 'look' ? 'Look' : 'Effects'}</button>)}
    </div>}

    {(!visual || tab === 'adjust') && <>
      {visual && <>
        <Range label="Size" value={pct(clip.transform.scale)} min={10} max={300} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, scale: v / 100 } })} />
        <Range label="Left / right" value={pct(clip.transform.x)} min={-50} max={150} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, x: v / 100 } })} />
        <Range label="Up / down" value={pct(clip.transform.y)} min={-50} max={150} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, y: v / 100 } })} />
        <Range label="Rotate" value={clip.transform.rotation} min={-180} max={180} unit="°" edit={edit} onChange={v => live({ transform: { ...clip.transform, rotation: v } })} />
        <Range label="Opacity" value={pct(clip.opacity)} min={0} max={100} unit="%" edit={edit} onChange={v => live({ opacity: v / 100 })} />
      </>}
      {asset.kind !== 'image' && <>
        <Range label="Volume" value={pct(clip.volume)} min={0} max={100} unit="%" edit={edit} onChange={v => live({ volume: v / 100 })} />
        <div className="ed-field"><span>Speed</span><div className="ed-chips">{[0.25, 0.5, 1, 1.5, 2, 4].map(s => <button key={s} className={clip.speed === s ? 'on' : ''} onClick={() => commit({ speed: s })}>{s}×</button>)}</div></div>
      </>}
    </>}

    {visual && tab === 'look' && <>
      <div className="ed-presets">
        {PRESETS.map(p => <button key={p.id} className={(clip.preset ?? 'none') === p.id ? 'on' : ''} onClick={() => commit({ preset: p.id, grade: { ...NO_GRADE, ...p.grade }, fx: { ...fx, bars: false, glow: 0, ...p.fx } })}>
          <span style={{ backgroundImage: asset.thumb ? `url(${asset.thumb})` : undefined, filter: thumbFilter(p.grade) }} />
          <small>{p.name}</small>
        </button>)}
      </div>
      <Range label="Brightness" value={pct(grade.brightness)} min={-100} max={100} edit={edit} onChange={v => setGrade({ brightness: v / 100 })} />
      <Range label="Contrast" value={pct(grade.contrast)} min={-100} max={100} edit={edit} onChange={v => setGrade({ contrast: v / 100 })} />
      <Range label="Saturation" value={pct(grade.saturation)} min={-100} max={100} edit={edit} onChange={v => setGrade({ saturation: v / 100 })} />
      <Range label="Warmth" value={pct(grade.warmth)} min={-100} max={100} edit={edit} onChange={v => setGrade({ warmth: v / 100 })} />
      <Range label="Tint" value={pct(grade.tint)} min={-100} max={100} edit={edit} onChange={v => setGrade({ tint: v / 100 })} />
      <Range label="Fade" value={pct(grade.fade)} min={0} max={100} edit={edit} onChange={v => setGrade({ fade: v / 100 })} />
      <Range label="Vignette" value={pct(grade.vignette)} min={0} max={100} edit={edit} onChange={v => setGrade({ vignette: v / 100 })} />
      <Range label="Film grain" value={pct(grade.grain)} min={0} max={100} edit={edit} onChange={v => setGrade({ grain: v / 100 })} />
      <Range label="Blur" value={pct(grade.blur)} min={0} max={100} edit={edit} onChange={v => setGrade({ blur: v / 100 })} />
      <Toggle label="Black & white" on={grade.mono} onChange={v => commit({ grade: { ...grade, mono: v }, preset: undefined })} />
      <button className="ed-btn block" onClick={() => commit({ grade: { ...NO_GRADE }, preset: 'none' })}>Reset look</button>
    </>}

    {visual && tab === 'fx' && <>
      <Range label="Fade in" value={fx.fadeIn} min={0} max={3} step={0.1} unit="s" edit={edit} onChange={v => setFx({ fadeIn: v })} />
      <Range label="Fade out" value={fx.fadeOut} min={0} max={3} step={0.1} unit="s" edit={edit} onChange={v => setFx({ fadeOut: v })} />
      <Range label="Slow zoom" value={pct(fx.zoom)} min={0} max={100} edit={edit} onChange={v => setFx({ zoom: v / 100 })} />
      <Range label="Camera shake" value={pct(fx.shake)} min={0} max={100} edit={edit} onChange={v => setFx({ shake: v / 100 })} />
      <Range label="Glow" value={pct(fx.glow)} min={0} max={100} edit={edit} onChange={v => setFx({ glow: v / 100 })} />
      <Range label="Glitch" value={pct(fx.glitch)} min={0} max={100} edit={edit} onChange={v => setFx({ glitch: v / 100 })} />
      <Toggle label="Flash in" hint="A white flash as the clip starts" on={fx.flash} onChange={v => commit({ fx: { ...fx, flash: v } })} />
      <Toggle label="Cinematic bars" hint="Letterbox top and bottom" on={fx.bars} onChange={v => commit({ fx: { ...fx, bars: v } })} />
      <button className="ed-btn block" onClick={() => commit({ fx: { ...NO_FX } })}><Sparkles size={14} /> Clear effects</button>
    </>}

    <div className="ed-row">
      <button className="ed-btn" onClick={onSplit}><Scissors size={14} /> Split</button>
      <button className="ed-btn" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
      <button className="ed-btn danger" onClick={onRemove}><Trash2 size={14} /> Delete</button>
    </div>
  </>
}
