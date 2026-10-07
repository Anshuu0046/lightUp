import { useEffect, useState } from 'react'
import { CloudUpload, FolderOpen, Trash2 } from 'lucide-react'
import { type CloudProject, deleteFromCloud, listCloud, openFromCloud, saveToCloud } from './projects'
import { SignIn } from './Account'
import { track, useAccount } from './supabase'
import type { Project } from '../editor/model'
import './cloud.css'

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString()
}
const len = (d: number) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`

/** Save the current project to the account, or open one saved before */
export function CloudDialog({ project, duration, cloudId, onSaved, onOpen, onClose }: { project: Project; duration: number; cloudId: string | null; onSaved: (id: string) => void; onOpen: (p: Project, id: string) => void; onClose: () => void }) {
  const { session } = useAccount()
  const [list, setList] = useState<CloudProject[] | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { if (session) listCloud().then(setList).catch(e => setError(e.message)) }, [session])
  if (!session) return <SignIn onClose={onClose} />

  const run = async (f: () => Promise<void>) => { setError(''); setProgress(0); try { await f() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setProgress(null) } }

  return <div className="cl-back" onMouseDown={() => progress === null && onClose()}>
    <div className="cl-modal wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Your projects">
      <h2>Your projects</h2>
      <p>Saved to your account, with all their media. Open them on any computer.</p>
      {progress !== null && <div className="cl-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {error && <p className="cl-error">{error}</p>}
      <button className="cl-btn primary block" disabled={progress !== null || !project.clips.length} onClick={() => run(async () => {
        const id = await saveToCloud(project, duration, cloudId, setProgress)
        track('cloud_save', { clips: project.clips.length })
        onSaved(id); setList(await listCloud())
      })}><CloudUpload size={15} /> {cloudId ? 'Save changes' : 'Save this project'}</button>
      <ul className="cl-list" style={{ marginTop: 14 }}>
        {list === null ? <li><span>Loading…</span></li> : list.length === 0 ? <li><span>Nothing saved yet<small>Your saved projects appear here.</small></span></li>
          : list.map(p => <li key={p.id} className={p.id === cloudId ? 'current' : ''}>
            <span>{p.name}<small>{len(p.duration)} · saved {ago(p.updated_at)}</small></span>
            <button className="cl-btn" disabled={progress !== null} onClick={() => run(async () => { const opened = await openFromCloud(p.id, setProgress); onOpen(opened, p.id); onClose() })}><FolderOpen size={14} /> Open</button>
            <button className="cl-btn danger" disabled={progress !== null} aria-label={`Delete ${p.name}`} onClick={() => confirm(`Delete “${p.name}” from your account? This can’t be undone.`) && run(async () => { await deleteFromCloud(p.id); setList(await listCloud()) })}><Trash2 size={14} /></button>
          </li>)}
      </ul>
      <button className="cl-btn block ghost" onClick={onClose}>Close</button>
    </div>
  </div>
}
