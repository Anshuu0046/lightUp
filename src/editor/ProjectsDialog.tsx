import { useEffect, useState } from 'react'
import { Copy, Film, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { duplicateProject, listProjects, type ProjectMeta } from './media'

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString()
}
const len = (d: number) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`

/** Every project on this device: open one, rename it, copy it, delete it, or start a new one */
export function ProjectsDialog({ currentId, currentName, onOpen, onNew, onRename, onDelete, onClose }: {
  currentId: string; currentName: string
  onOpen: (id: string) => void; onNew: () => void; onRename: (id: string, name: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onClose: () => void
}) {
  const [list, setList] = useState<ProjectMeta[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const refresh = () => listProjects().then(setList).catch(() => setList([]))
  useEffect(() => { refresh() }, [])

  const commitName = async (id: string) => { const n = draft.trim(); setEditing(null); if (n) { await onRename(id, n); refresh() } }

  return <div className="ed-modal-back" onMouseDown={onClose}>
    <div className="ed-modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Your projects">
      <h2>Your projects</h2>
      <p>Saved on this device, with their media. Pick one to keep editing.</p>
      <button className="ed-btn primary block" onClick={onNew}><Plus size={15} /> New project</button>
      <ul className="ed-projects">
        {list === null ? <li className="ed-note">Loading…</li> : list.length === 0 ? <li className="ed-note">Nothing here yet. Add some clips and your project will appear.</li>
          : list.map(p => <li key={p.id} className={p.id === currentId ? 'current' : ''}>
            <span className="ed-pthumb" style={p.thumb ? { backgroundImage: `url(${p.thumb})` } : undefined}>{!p.thumb && <Film size={18} />}</span>
            <span className="ed-pinfo">
              {editing === p.id
                ? <input className="ed-input" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => commitName(p.id)} onKeyDown={e => { if (e.key === 'Enter') commitName(p.id); if (e.key === 'Escape') setEditing(null) }} />
                : <b>{p.id === currentId ? currentName : p.name}</b>}
              <small>{p.id === currentId ? 'Open now · ' : ''}{len(p.duration)} · {p.clips} clip{p.clips === 1 ? '' : 's'} · {ago(p.updated)}</small>
            </span>
            <span className="ed-pact">
              {p.id !== currentId && <button className="ed-btn small" onClick={() => onOpen(p.id)}><FolderOpen size={13} /> Edit</button>}
              <button className="ed-btn small ghost" aria-label={`Rename ${p.name}`} onClick={() => { setEditing(p.id); setDraft(p.id === currentId ? currentName : p.name) }}><Pencil size={13} /></button>
              <button className="ed-btn small ghost" aria-label={`Duplicate ${p.name}`} onClick={async () => { await duplicateProject(p.id); refresh() }}><Copy size={13} /></button>
              <button className="ed-btn small ghost danger" aria-label={`Delete ${p.name}`} onClick={async () => { if (confirm(`Delete “${p.name}” from this device? This can’t be undone.`)) { await onDelete(p.id); refresh() } }}><Trash2 size={13} /></button>
            </span>
          </li>)}
      </ul>
      <button className="ed-btn block" onClick={onClose}>Close</button>
    </div>
  </div>
}
