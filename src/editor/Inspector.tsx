import { useState } from 'react'
import { useEffect, useRef } from 'react'
import { Copy, Diamond, Lightbulb, Scissors, Sparkles, Trash2, Upload } from 'lucide-react'
import { type Asset, type Clip, clipLength, collides, type Project } from './model'
import { MOTIONS, motionKeys, type Pose, poseAt, setKey, withPose } from './keyframes'
import { applyLut, BUILTIN_LUTS, lutData, setCustomLuts } from './lut'
import { EYE_COLORS, EYE_FX, type EyeKind } from './eyes'
import { type Fx, type Grade, NO_FX, NO_GRADE, PRESETS, thumbFilter } from './looks'
import { type ClipAudio, NO_AUDIO } from './audio'
import { DEFAULT_LIGHTING, type Lighting, relightReady } from './relight'
import { Swatches } from '../live/Swatches'
import { BASE_TEXT, ensureFont, FONTS, TEXT_TEMPLATES, type TextAnim, type TextSpec } from './text'

type Edit = {
  begin: () => void
  live: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
  end: () => void
  commit: (a: { type: 'updateClip'; id: string; patch: Partial<Clip> }) => void
}

type Props = { project: Project; clip: Clip; asset?: Asset; time: number; onSeek: (t: number) => void; onLut: (file: File) => void; edit: Edit; onSplit: () => void; onDuplicate: () => void; onRemove: () => void; onError: (m: string) => void; onDetach?: () => void; onRefine?: () => void }

/** A slider whose whole drag is one undo step */
function Range({ label, value, min, max, unit = '', step = 1, edit, onChange }: { label: string; value: number; min: number; max: number; unit?: string; step?: number; edit: Edit; onChange: (v: number) => void }) {
  return <label className="ed-field"><span>{label} <b>{value}{unit}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onPointerDown={edit.begin} onPointerUp={edit.end} onKeyDown={edit.begin} onKeyUp={edit.end} onChange={e => onChange(+e.target.value)} />
  </label>
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return <label className="ed-toggle"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} /><i /></label>
}

export function Inspector({ project, clip, asset, time, onSeek, onLut, edit, onSplit, onDuplicate, onRemove, onError, onDetach, onRefine }: Props) {
  const visual = !asset || asset.kind !== 'audio'
  const text = clip.text
  const tabs = text ? (['text', 'adjust', 'fx'] as const) : (['adjust', 'look', 'light', 'fx'] as const)
  const [tab, setTab] = useState<'text' | 'adjust' | 'look' | 'light' | 'fx'>(text ? 'text' : 'adjust')
  const grade = { ...NO_GRADE, ...clip.grade }, fx = { ...NO_FX, ...clip.fx }
  const live = (patch: Partial<Clip>) => edit.live({ type: 'updateClip', id: clip.id, patch })
  const setGrade = (p: Partial<Grade>) => live({ grade: { ...grade, ...p }, preset: undefined })
  const setFx = (p: Partial<Fx>) => live({ fx: { ...fx, ...p } })
  const commit = (patch: Partial<Clip>) => {
    if (collides(project, { ...clip, ...patch })) { onError('That would overlap the next clip. Move it first.'); return }
    edit.commit({ type: 'updateClip', id: clip.id, patch })
  }
  const pct = (v: number) => Math.round(v * 100)
  setCustomLuts(project.luts)
  const pose = poseAt(clip, time)
  const poseLive = (p: Partial<Pose>) => live(withPose(clip, time, p))
  const local = time - clip.start
  const keys = clip.keys ?? []
  const addKey = () => edit.commit({ type: 'updateClip', id: clip.id, patch: { keys: setKey(keys, local, pose) } })
  const sound = { ...NO_AUDIO, ...clip.audio }
  const setSound = (p: Partial<ClipAudio>) => live({ audio: { ...sound, ...p } })
  const onVisual = project.tracks.find(t => t.id === clip.trackId)?.kind === 'visual'
  const setText = (p: Partial<TextSpec>) => { if (!text) return; const next = { ...text, ...p }; live({ text: next }); if (p.font || p.weight || p.italic !== undefined) ensureFont(next).then(() => live({ text: { ...next } })) }
  const commitText = (p: Partial<TextSpec>) => { if (!text) return; const next = { ...text, ...p }; edit.commit({ type: 'updateClip', id: clip.id, patch: { text: next } }); ensureFont(next).then(() => live({ text: { ...next } })) }

  return <>
    <div className="ed-side-head"><b title={asset?.name}>{text ? 'Text' : asset?.name}</b></div>
    {visual && <div className="ed-segment" role="tablist">
      {tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'text' ? 'Text' : t === 'adjust' ? 'Adjust' : t === 'look' ? 'Look' : t === 'light' ? 'Light' : 'Effects'}</button>)}
    </div>}

    {text && tab === 'text' && <TextPanel text={text} edit={edit} setText={setText} commitText={commitText} />}

    {(!visual || tab === 'adjust') && <>
      {visual && <>
        <Range label="Size" value={pct(pose.scale)} min={10} max={300} unit="%" edit={edit} onChange={v => poseLive({ scale: v / 100 })} />
        <Range label="Left / right" value={pct(pose.x)} min={-50} max={150} unit="%" edit={edit} onChange={v => poseLive({ x: v / 100 })} />
        <Range label="Up / down" value={pct(pose.y)} min={-50} max={150} unit="%" edit={edit} onChange={v => poseLive({ y: v / 100 })} />
        <Range label="Rotate" value={Math.round(pose.rotation)} min={-180} max={180} unit="°" edit={edit} onChange={v => poseLive({ rotation: v })} />
        <Range label="Opacity" value={pct(pose.opacity)} min={0} max={100} unit="%" edit={edit} onChange={v => poseLive({ opacity: v / 100 })} />
        <div className="ed-card"><b className="ed-card-title">Keyframes</b>
          <small className="ed-note">Animate size, position, rotation and opacity. Add a keyframe, move the playhead, change a setting above, and Light Up fills in the motion between.</small>
          <button className="ed-btn block" disabled={local < -0.001 || local > clipLength(clip) + 0.001} onClick={addKey}><Diamond size={14} /> Add keyframe at playhead</button>
          <div className="ed-field"><span>Quick motion</span><div className="ed-chips">{MOTIONS.map(m => <button key={m.id} onClick={() => commit({ keys: motionKeys(clip, m.id, clipLength(clip)) })}>{m.name}</button>)}</div></div>
          {keys.length > 0 && <>
            <ul className="ed-keys">{keys.map((k, i) => <li key={i} className={Math.abs(k.t - local) < 0.04 ? 'on' : ''}>
              <button onClick={() => onSeek(clip.start + k.t)}>◆ {k.t.toFixed(1)}s · {Math.round(k.scale * 100)}% · {Math.round(k.opacity * 100)}%</button>
              <button className="x" aria-label="Remove this keyframe" onClick={() => commit({ keys: keys.length > 1 ? keys.filter((_, j) => j !== i) : undefined })}>×</button></li>)}</ul>
            <button className="ed-btn block" onClick={() => commit({ keys: undefined })}>Remove all keyframes</button>
          </>}
        </div>
        <div className="ed-field"><span>Flip</span><div className="ed-chips">
          <button className={clip.flipX ? 'on' : ''} onClick={() => commit({ flipX: !clip.flipX })}>Mirror</button>
          <button className={clip.flipY ? 'on' : ''} onClick={() => commit({ flipY: !clip.flipY })}>Upside down</button></div></div>
        <div className="ed-field"><span>Shape</span><div className="ed-chips">{(['none', 'rounded', 'circle'] as const).map(s => <button key={s} className={(clip.shape ?? 'none') === s ? 'on' : ''} onClick={() => commit({ shape: s })}>{s === 'none' ? 'Full' : s === 'rounded' ? 'Rounded' : 'Circle'}</button>)}
          <button onClick={() => commit({ transform: { ...clip.transform, scale: 0.36, x: 0.74, y: 0.2 }, shape: clip.shape && clip.shape !== 'none' ? clip.shape : 'rounded' })}>Picture-in-picture</button></div></div>
        {asset && asset.kind !== 'audio' && <>
          <div className="ed-field"><span>Background</span><div className="ed-chips">{(['none', 'remove', 'blur'] as const).map(m => <button key={m} className={(clip.cutout?.mode ?? 'none') === m ? 'on' : ''} onClick={() => commit({ cutout: m === 'none' ? undefined : { threshold: 0.5, feather: 0.3, ...clip.cutout, mode: m } })}>{m === 'none' ? 'Keep' : m === 'remove' ? 'Remove' : 'Blur'}</button>)}</div>
            <small className="ed-note">Finds people automatically. Put a new background on the Main track below.</small></div>
          {clip.cutout && <>
            <Range label="Edge" value={pct(clip.cutout.threshold)} min={15} max={85} edit={edit} onChange={v => live({ cutout: { ...clip.cutout!, threshold: v / 100 } })} />
            <Range label="Edge softness" value={pct(clip.cutout.feather)} min={0} max={100} edit={edit} onChange={v => live({ cutout: { ...clip.cutout!, feather: v / 100 } })} />
          </>}
          {asset.kind === 'image' && onRefine && <button className="ed-btn block" onClick={onRefine}>Cut out by hand…</button>}
        </>}
      </>}
      {asset && asset.kind !== 'image' && <>
        {asset.hasAudio && <>
          <Range label="Volume" value={pct(clip.volume)} min={0} max={200} unit="%" edit={edit} onChange={v => live({ volume: v / 100 })} />
          <Range label="Sound fade in" value={sound.fadeIn} min={0} max={5} step={0.1} unit="s" edit={edit} onChange={v => setSound({ fadeIn: v })} />
          <Range label="Sound fade out" value={sound.fadeOut} min={0} max={5} step={0.1} unit="s" edit={edit} onChange={v => setSound({ fadeOut: v })} />
          <Toggle label="Enhance voice" hint="Clearer, fuller speech: cuts rumble, lifts presence, evens the level" on={sound.enhance} onChange={v => commit({ audio: { ...sound, enhance: v } })} />
          <Toggle label="Remove audio" hint="Silences this clip. Switch it off to bring the sound back." on={!!clip.muted} onChange={v => commit({ muted: v })} />
          {onVisual && asset.kind === 'video' && onDetach && <button className="ed-btn block" onClick={onDetach}>Detach audio to its own track</button>}
        </>}
        {!asset.hasAudio && asset.kind === 'video' && <p className="ed-note">This video has no sound.</p>}
        <Toggle label="Reverse" hint="Plays backwards. The preview shows the picture only; the backwards sound is in the exported video." on={!!clip.reverse} onChange={v => commit({ reverse: v })} />
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
      <LutPicker project={project} clip={clip} thumb={asset?.thumb} edit={edit} commit={commit} live={live} onImport={onLut} />
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

    {visual && tab === 'light' && <LightPanel light={clip.light} edit={edit} set={l => live({ light: l })} commit={l => edit.commit({ type: 'updateClip', id: clip.id, patch: { light: l } })} />}

    {visual && tab === 'fx' && <>
      <div className="ed-card"><b className="ed-card-title">Eye effects</b>
        <div className="ed-chips">
          <button className={!clip.eyes ? 'on' : ''} onClick={() => commit({ eyes: undefined })}>Off</button>
          {EYE_FX.map(e => <button key={e.id} className={clip.eyes?.kind === e.id ? 'on' : ''} onClick={() => commit({ eyes: { kind: e.id as EyeKind, color: e.id === clip.eyes?.kind ? clip.eyes.color : e.color, size: clip.eyes?.size ?? 1 } })}>{e.name}</button>)}
        </div>
        {clip.eyes && <>
          {clip.eyes.kind !== 'shades' && <div className="ed-field"><span>Colour</span><div className="ed-colors">{EYE_COLORS.map(c => <button key={c} aria-label={`Colour ${c}`} className={`ed-dot ${clip.eyes!.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => commit({ eyes: { ...clip.eyes!, color: c } })} />)}</div></div>}
          <Range label="Size" value={pct(clip.eyes.size)} min={50} max={200} unit="%" edit={edit} onChange={v => live({ eyes: { ...clip.eyes!, size: v / 100 } })} />
          <small className="ed-note">Finds the face in the clip and follows the eyes. Works best when the face looks toward the camera.</small>
        </>}
      </div>
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

/** Studio lighting on a filmed clip: a focus light on the person, the room level, and a coloured lamp behind them */
function LightPanel({ light, edit, set, commit }: { light?: Lighting; edit: Edit; set: (l: Lighting) => void; commit: (l: Lighting | undefined) => void }) {
  if (!light) return <div className="ed-nothing"><b>Studio lighting</b>Light the person in this clip like a studio would: a focus light you can move and colour, a darker room, and an RGB lamp on the wall behind them.
    <button className="ed-btn primary block" onClick={() => commit(DEFAULT_LIGHTING)}><Lightbulb size={15} /> Add lighting</button></div>
  const L = light, s = (p: Partial<Lighting>) => set({ ...L, ...p })
  return <>
    <div className="ed-card"><b className="ed-card-title">Focus light</b>
      <Range label="Brightness" value={L.key} min={0} max={100} edit={edit} onChange={v => s({ key: v })} />
      <div className="ed-field"><span>Colour</span><Swatches value={L.keyHue} none={{ id: 'white', name: 'White' }} onPick={keyHue => commit({ ...L, keyHue })} /></div>
      {L.keyHue === 'white' && <Range label="Warmth" value={L.warmth} min={2000} max={9000} step={100} unit="K" edit={edit} onChange={v => s({ warmth: v })} />}
      <Range label="Left / right" value={Math.round(L.x * 100)} min={0} max={100} edit={edit} onChange={v => s({ x: v / 100 })} />
      <Range label="Up / down" value={Math.round(L.y * 100)} min={0} max={100} edit={edit} onChange={v => s({ y: v / 100 })} />
      <Range label="Softness" value={L.soft} min={0} max={100} edit={edit} onChange={v => s({ soft: v })} />
    </div>
    <div className="ed-card"><b className="ed-card-title">Room</b>
      <Range label="Room light" value={L.room} min={10} max={100} unit="%" edit={edit} onChange={v => s({ room: v })} />
      <small className="ed-note">Lower it so the person stands out from the background.</small>
    </div>
    <div className="ed-card"><b className="ed-card-title">Background light</b>
      <div className="ed-field"><Swatches value={L.back} none={{ id: 'off', name: 'Off' }} onPick={back => commit({ ...L, back })} /></div>
      {L.back !== 'off' && <>
        <Range label="Brightness" value={L.backLevel} min={0} max={100} edit={edit} onChange={v => s({ backLevel: v })} />
        <Range label="Lamp position" value={L.backSide} min={0} max={100} edit={edit} onChange={v => s({ backSide: v })} />
      </>}
    </div>
    <small className="ed-note">{relightReady() ? 'Depth lighting: the light wraps around faces and casts real shadows.' : 'This device can’t run depth lighting, so a simpler light is used.'}</small>
    <button className="ed-btn block" onClick={() => commit(undefined)}>Remove lighting</button>
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

/** Filters made from colour lookup tables: ten built in, plus any .cube file */
function LutPicker({ project, clip, thumb, edit, commit, live, onImport }: { project: Project; clip: Clip; thumb?: string; edit: Edit; commit: (p: Partial<Clip>) => void; live: (p: Partial<Clip>) => void; onImport: (f: File) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const all = [...BUILTIN_LUTS.map(l => ({ id: l.id, name: l.name })), ...(project.luts ?? []).map(l => ({ id: l.id, name: l.name }))]
  return <div className="ed-card"><b className="ed-card-title">Colour filters (LUTs)</b>
    <div className="ed-presets">
      <button className={!clip.lut ? 'on' : ''} onClick={() => commit({ lut: undefined })}><LutThumb src={thumb} /><small>None</small></button>
      {all.map(l => <button key={l.id} className={clip.lut?.id === l.id ? 'on' : ''} onClick={() => commit({ lut: { id: l.id, strength: clip.lut?.strength ?? 1 } })}><LutThumb src={thumb} id={l.id} /><small>{l.name}</small></button>)}
    </div>
    {clip.lut && <Range label="Strength" value={Math.round(clip.lut.strength * 100)} min={0} max={100} unit="%" edit={edit} onChange={v => live({ lut: { ...clip.lut!, strength: v / 100 } })} />}
    <input ref={file} type="file" accept=".cube" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
    <button className="ed-btn block" onClick={() => file.current?.click()}><Upload size={14} /> Import a .cube LUT</button>
  </div>
}

function LutThumb({ src, id }: { src?: string; id?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d', { willReadFrequently: true })!
    const paint = (img?: HTMLImageElement) => {
      g.fillStyle = '#3a3a4a'; g.fillRect(0, 0, c.width, c.height)
      if (img) { const s = Math.max(c.width / img.width, c.height / img.height); g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s) }
      else { const grad = g.createLinearGradient(0, 0, c.width, c.height); grad.addColorStop(0, '#e8a06a'); grad.addColorStop(0.5, '#7a8f6a'); grad.addColorStop(1, '#4a6c9a'); g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height) }
      const lut = id ? lutData(id) : null
      if (lut) applyLut(g, c.width, c.height, lut, 1)
    }
    if (!src) return paint()
    const img = new Image(); img.onload = () => paint(img); img.onerror = () => paint(); img.src = src
  }, [src, id])
  return <canvas ref={ref} width={64} height={64} className="ed-lut" />
}
