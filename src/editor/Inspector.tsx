import { useState } from 'react'
import { Copy, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { type Asset, type Clip, collides, type Project } from './model'
import { type Fx, type Grade, NO_FX, NO_GRADE, PRESETS, thumbFilter } from './looks'
import { type ClipAudio, NO_AUDIO } from './audio'
import { BASE_TEXT, ensureFont, FONTS, TEXT_TEMPLATES, type TextAnim, type TextSpec } from './text'

type Edit = {
  begin: () => void
  live: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
  end: () => void
  commit: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
}

type Props = { project: Project; clip: Clip; asset?: Asset; edit: Edit; onSplit: () => void; onDuplicate: () => void; onRemove: () => void; onError: (m: string) => void; onDetach?: () => void }

/** A slider whose whole drag is one undo step */
function Range({ label, value, min, max, unit = '', step = 1, edit, onChange }: { label: string; value: number; min: number; max: number; unit?: string; step?: number; edit: Edit; onChange: (v: number) => void }) {
  return <label className="ed-field"><span>{label} <b>{value}{unit}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onPointerDown={edit.begin} onPointerUp={edit.end} onKeyDown={edit.begin} onKeyUp={edit.end} onChange={e => onChange(+e.target.value)} />
  </label>
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return <label className="ed-toggle"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} /><i /></label>
}

export function Inspector({ project, clip, asset, edit, onSplit, onDuplicate, onRemove, onError, onDetach }: Props) {
  const visual = !asset || asset.kind !== 'audio'
  const text = clip.text
  const tabs = text ? (['text', 'adjust', 'fx'] as const) : (['adjust', 'look', 'fx'] as const)
  const [tab, setTab] = useState<'text' | 'adjust' | 'look' | 'fx'>(text ? 'text' : 'adjust')
  const grade = { ...NO_GRADE, ...clip.grade }, fx = { ...NO_FX, ...clip.fx }
  const live = (patch: Partial<Clip>) => edit.live({ type: 'updateClip', id: clip.id, patch })
  const setGrade = (p: Partial<Grade>) => live({ grade: { ...grade, ...p }, preset: undefined })
  const setFx = (p: Partial<Fx>) => live({ fx: { ...fx, ...p } })
  const commit = (patch: Partial<Clip>) => {
    if (collides(project, { ...clip, ...patch })) { onError('That would overlap the next clip. Move it first.'); return }
    edit.commit({ type: 'updateClip', id: clip.id, patch })
  }
  const pct = (v: number) => Math.round(v * 100)
  const sound = { ...NO_AUDIO, ...clip.audio }
  const setSound = (p: Partial<ClipAudio>) => live({ audio: { ...sound, ...p } })
  const onVisual = project.tracks.find(t => t.id === clip.trackId)?.kind === 'visual'
  const setText = (p: Partial<TextSpec>) => { if (!text) return; const next = { ...text, ...p }; live({ text: next }); if (p.font || p.weight || p.italic !== undefined) ensureFont(next).then(() => live({ text: { ...next } })) }
  const commitText = (p: Partial<TextSpec>) => { if (!text) return; const next = { ...text, ...p }; edit.commit({ type: 'updateClip', id: clip.id, patch: { text: next } }); ensureFont(next).then(() => live({ text: { ...next } })) }

  return <>
    <div className="ed-side-head"><b title={asset?.name}>{text ? 'Text' : asset?.name}</b></div>
    {visual && <div className="ed-segment" role="tablist">
      {tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'text' ? 'Text' : t === 'adjust' ? 'Adjust' : t === 'look' ? 'Look' : 'Effects'}</button>)}
    </div>}

    {text && tab === 'text' && <TextPanel text={text} edit={edit} setText={setText} commitText={commitText} />}

    {(!visual || tab === 'adjust') && <>
      {visual && <>
        <Range label="Size" value={pct(clip.transform.scale)} min={10} max={300} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, scale: v / 100 } })} />
        <Range label="Left / right" value={pct(clip.transform.x)} min={-50} max={150} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, x: v / 100 } })} />
        <Range label="Up / down" value={pct(clip.transform.y)} min={-50} max={150} unit="%" edit={edit} onChange={v => live({ transform: { ...clip.transform, y: v / 100 } })} />
        <Range label="Rotate" value={clip.transform.rotation} min={-180} max={180} unit="°" edit={edit} onChange={v => live({ transform: { ...clip.transform, rotation: v } })} />
        <Range label="Opacity" value={pct(clip.opacity)} min={0} max={100} unit="%" edit={edit} onChange={v => live({ opacity: v / 100 })} />
      </>}
      {asset && asset.kind !== 'image' && <>
        {asset.hasAudio && <>
          <Range label="Volume" value={pct(clip.volume)} min={0} max={200} unit="%" edit={edit} onChange={v => live({ volume: v / 100 })} />
          <Range label="Sound fade in" value={sound.fadeIn} min={0} max={5} step={0.1} unit="s" edit={edit} onChange={v => setSound({ fadeIn: v })} />
          <Range label="Sound fade out" value={sound.fadeOut} min={0} max={5} step={0.1} unit="s" edit={edit} onChange={v => setSound({ fadeOut: v })} />
          <Toggle label="Enhance voice" hint="Clearer, fuller speech: cuts rumble, lifts presence, evens the level" on={sound.enhance} onChange={v => commit({ audio: { ...sound, enhance: v } })} />
          {onVisual && asset.kind === 'video' && onDetach && <button className="ed-btn block" onClick={onDetach}>Detach audio to its own track</button>}
        </>}
        {!asset.hasAudio && asset.kind === 'video' && <p className="ed-note">This video has no sound.</p>}
        <div className="ed-field"><span>Speed</span><div className="ed-chips">{[0.25, 0.5, 1, 1.5, 2, 4].map(s => <button key={s} className={clip.speed === s ? 'on' : ''} onClick={() => commit({ speed: s })}>{s}×</button>)}</div></div>
      </>}
    </>}

    {visual && tab === 'look' && <>
      <div className="ed-presets">
        {PRESETS.map(p => <button key={p.id} className={(clip.preset ?? 'none') === p.id ? 'on' : ''} onClick={() => commit({ preset: p.id, grade: { ...NO_GRADE, ...p.grade }, fx: { ...fx, bars: false, glow: 0, ...p.fx } })}>
          <span style={{ backgroundImage: asset?.thumb ? `url(${asset.thumb})` : undefined, filter: thumbFilter(p.grade) }} />
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

const ANIMS: { id: TextAnim; label: string }[] = [{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' }, { id: 'pop', label: 'Pop' }, { id: 'slide', label: 'Slide' }, { id: 'bounce', label: 'Bounce' }, { id: 'typewriter', label: 'Type' }]

function TextPanel({ text, edit, setText, commitText }: { text: TextSpec; edit: Edit; setText: (p: Partial<TextSpec>) => void; commitText: (p: Partial<TextSpec>) => void }) {
  const font = FONTS.find(f => f.family === text.font) ?? FONTS[0]
  return <>
    <textarea className="ed-textarea" value={text.content} rows={3} placeholder="Type your text" onFocus={edit.begin} onBlur={edit.end} onChange={e => setText({ content: e.target.value })} />
    <div className="ed-field"><span>Style</span>
      <div className="ed-templates">{TEXT_TEMPLATES.map(t => { const s = { ...BASE_TEXT, ...t.spec }; return <button key={t.id} title={t.name} onClick={() => commitText({ ...t.spec, ...Object.fromEntries(Object.keys(BASE_TEXT).filter(k => !(k in t.spec) && k !== 'content').map(k => [k, BASE_TEXT[k as keyof TextSpec]])) })}
        style={{ fontFamily: `"${s.font}"`, fontWeight: s.weight, fontStyle: s.italic ? 'italic' : undefined, color: s.color, background: s.bg !== 'none' ? s.bgColor : undefined, WebkitTextStroke: s.stroke ? `${s.stroke * 1.5}px ${s.strokeColor}` : undefined, textTransform: s.uppercase ? 'uppercase' : undefined, textShadow: s.color2 ? `0 0 8px ${s.color}` : undefined }}>Aa<small>{t.name}</small></button> })}</div>
    </div>
    <label className="ed-field"><span>Font</span>
      <select className="ed-input" value={text.font} onChange={e => { const f = FONTS.find(x => x.family === e.target.value)!; commitText({ font: f.family, weight: f.weights.includes(text.weight) ? text.weight : f.weights[f.weights.length - 1] }) }}>
        {FONTS.map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
      </select></label>
    {font.weights.length > 1 && <div className="ed-field"><span>Weight</span><div className="ed-chips">{font.weights.map(w => <button key={w} className={text.weight === w ? 'on' : ''} onClick={() => commitText({ weight: w })}>{w >= 800 ? 'Black' : w >= 700 ? 'Bold' : w >= 600 ? 'Semi' : 'Regular'}</button>)}</div></div>}
    <Range label="Size" value={text.size} min={20} max={240} edit={edit} onChange={v => setText({ size: v })} />
    <div className="ed-field"><span>Colour</span><div className="ed-colors">
      <input type="color" value={text.color} onPointerDown={edit.begin} onBlur={edit.end} onChange={e => setText({ color: e.target.value })} aria-label="Text colour" />
      <label className="ed-mini"><input type="checkbox" checked={!!text.color2} onChange={e => commitText({ color2: e.target.checked ? '#6ae4ff' : null })} /> Gradient</label>
      {text.color2 && <input type="color" value={text.color2} onPointerDown={edit.begin} onBlur={edit.end} onChange={e => setText({ color2: e.target.value })} aria-label="Second colour" />}
    </div></div>
    <div className="ed-field"><span>Align</span><div className="ed-chips">{(['left', 'center', 'right'] as const).map(a => <button key={a} className={text.align === a ? 'on' : ''} onClick={() => commitText({ align: a })}>{a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}</button>)}
      <button className={text.uppercase ? 'on' : ''} onClick={() => commitText({ uppercase: !text.uppercase })}>AA</button>
      <button className={text.italic ? 'on' : ''} onClick={() => commitText({ italic: !text.italic })}><i>I</i></button></div></div>
    <Range label="Wrap width" value={Math.round(text.width * 100)} min={20} max={100} unit="%" edit={edit} onChange={v => setText({ width: v / 100 })} />
    <Range label="Letter spacing" value={Math.round(text.spacing * 100)} min={-20} max={100} edit={edit} onChange={v => setText({ spacing: v / 100 })} />
    <Range label="Line height" value={Math.round(text.lineHeight * 100)} min={80} max={200} unit="%" edit={edit} onChange={v => setText({ lineHeight: v / 100 })} />
    <Range label="Outline" value={Math.round(text.stroke * 100)} min={0} max={100} edit={edit} onChange={v => setText({ stroke: v / 100 })} />
    {text.stroke > 0 && <div className="ed-field"><span>Outline colour</span><input type="color" value={text.strokeColor} onPointerDown={edit.begin} onBlur={edit.end} onChange={e => setText({ strokeColor: e.target.value })} /></div>}
    <Range label="Shadow / glow" value={Math.round(text.shadow * 100)} min={0} max={100} edit={edit} onChange={v => setText({ shadow: v / 100 })} />
    <div className="ed-field"><span>Background</span><div className="ed-chips">{(['none', 'box', 'pill', 'highlight'] as const).map(b => <button key={b} className={text.bg === b ? 'on' : ''} onClick={() => commitText({ bg: b })}>{b === 'none' ? 'None' : b === 'box' ? 'Box' : b === 'pill' ? 'Pill' : 'Marker'}</button>)}</div></div>
    {text.bg !== 'none' && <>
      <div className="ed-field"><span>Background colour</span><input type="color" value={text.bgColor} onPointerDown={edit.begin} onBlur={edit.end} onChange={e => setText({ bgColor: e.target.value })} /></div>
      <Range label="Background opacity" value={Math.round(text.bgOpacity * 100)} min={10} max={100} unit="%" edit={edit} onChange={v => setText({ bgOpacity: v / 100 })} />
    </>}
    <div className="ed-field"><span>Animate in</span><div className="ed-chips">{ANIMS.map(a => <button key={a.id} className={text.animIn === a.id ? 'on' : ''} onClick={() => commitText({ animIn: a.id })}>{a.label}</button>)}</div></div>
    <div className="ed-field"><span>Animate out</span><div className="ed-chips">{ANIMS.filter(a => a.id !== 'bounce' && a.id !== 'typewriter').map(a => <button key={a.id} className={text.animOut === a.id ? 'on' : ''} onClick={() => commitText({ animOut: a.id as TextSpec['animOut'] })}>{a.label}</button>)}</div></div>
  </>
}
