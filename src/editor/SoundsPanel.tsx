import { Play, Plus } from 'lucide-react'
import type { Ducking } from './audio'
import { previewSfx, SFX, sfxFile } from './sfx'

/** Built-in sound effects, plus the project's music ducking */
export function SoundsPanel({ ducking, onDucking, onAdd }: { ducking: Ducking; onDucking: (d: Ducking) => void; onAdd: (f: File) => void }) {
  return <>
    <div className="ed-card">
      <label className="ed-toggle"><span>Duck music under speech<small>Music on the Music track dips whenever someone talks</small></span>
        <input type="checkbox" checked={ducking.on} onChange={e => onDucking({ ...ducking, on: e.target.checked })} /><i /></label>
      {ducking.on && <label className="ed-field"><span>How much quieter <b>{Math.round(ducking.amount * 100)}%</b></span>
        <input type="range" min={20} max={95} value={Math.round(ducking.amount * 100)} onChange={e => onDucking({ ...ducking, amount: +e.target.value / 100 })} /></label>}
    </div>
    <div className="ed-side-head"><b>Sound effects</b><small className="ed-note">Free to use anywhere</small></div>
    <ul className="ed-sfx">
      {SFX.map(s => <li key={s.id}>
        <button className="ed-sfx-play" onClick={() => previewSfx(s.id)} aria-label={`Play ${s.name}`}><Play size={12} /></button>
        <span>{s.name}<small>{s.seconds < 1 ? `${Math.round(s.seconds * 1000)} ms` : `${s.seconds} s`}</small></span>
        <button className="ed-sfx-add" onClick={async () => onAdd(await sfxFile(s.id))} aria-label={`Add ${s.name} at the playhead`}><Plus size={14} /></button>
      </li>)}
    </ul>
  </>
}
