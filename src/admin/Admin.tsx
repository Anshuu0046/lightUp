import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, BarChart3, Clapperboard, Image as ImageIcon, Search, Settings, Trash2, Upload, Users } from 'lucide-react'
import { cloudEnabled, type Profile, supabase, useAccount } from '../cloud/supabase'
import { SignIn } from '../cloud/Account'
import '../cloud/cloud.css'
import './admin.css'

type Section = 'overview' | 'users' | 'projects' | 'stickers' | 'activity' | 'settings'
type Stats = { users: number; new_users: number; active_users: number; projects: number; banned: number; by_type: Record<string, number>; daily: { day: string; events: number; users: number }[] }
type Event = { id: number; user_id: string | null; type: string; meta: Record<string, unknown>; created_at: string }
type ProjectRow = { id: string; name: string; user_id: string; updated_at: string; duration: number }
type StickerRow = { id: string; name: string; path: string; tags: string[]; published: boolean; created_at: string }

const SECTIONS: { id: Section; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 }, { id: 'users', label: 'Users', icon: Users }, { id: 'projects', label: 'Projects', icon: Clapperboard },
  { id: 'stickers', label: 'Stickers', icon: ImageIcon }, { id: 'activity', label: 'Activity', icon: Activity }, { id: 'settings', label: 'Settings', icon: Settings },
]
const EVENT_NAMES: Record<string, string> = { export: 'Videos exported', captions: 'Caption runs', live_start: 'Live camera sessions', cloud_save: 'Cloud saves', vcam_start: 'Used as Zoom/OBS camera' }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function Admin() {
  const { session, loading, isAdmin } = useAccount()
  const [section, setSection] = useState<Section>('overview')

  if (!cloudEnabled) return <Gate title="Connect Supabase to use the admin panel">
    <ol className="ad-steps">
      <li>Create a free project at <b>supabase.com</b>.</li>
      <li>Open <b>SQL editor</b>, paste the contents of <code>supabase/schema.sql</code> and run it.</li>
      <li>In <b>Project settings → API</b>, copy the project URL and the <i>anon public</i> key into a file named <code>.env</code> next to <code>package.json</code> (see <code>.env.example</code>).</li>
      <li>In <b>Authentication → Email templates</b>, make sure the sign-in email shows the code: <code>{'{{ .Token }}'}</code>.</li>
      <li>Rebuild the app, sign in once, then run <code>update public.profiles set role = 'admin' where email = 'you@example.com';</code></li>
    </ol>
  </Gate>
  if (loading) return <Gate title="Loading…" />
  if (!session) return <SignIn onClose={() => { location.hash = '' }} />
  if (!isAdmin) return <Gate title="Admins only"><p>Your account doesn’t have admin access. Ask an existing admin to make you one.</p></Gate>

  return <div className="ad">
    <aside className="ad-nav">
      <a className="ad-back" href="#"><ArrowLeft size={15} /> Light Up</a>
      <b className="ad-title">Admin</b>
      {SECTIONS.map(s => <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}><s.icon size={16} /> {s.label}</button>)}
    </aside>
    <main className="ad-main">
      {section === 'overview' && <Overview />}
      {section === 'users' && <UsersSection />}
      {section === 'projects' && <ProjectsSection />}
      {section === 'stickers' && <StickersSection />}
      {section === 'activity' && <ActivitySection />}
      {section === 'settings' && <SettingsSection />}
    </main>
  </div>
}

function Gate({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="ad-gate"><div><a className="ad-back" href="#"><ArrowLeft size={15} /> Light Up</a><h1>{title}</h1>{children}</div></div>
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const reload = () => load().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => { reload() }, deps)
  return { data, error, reload }
}
const must = <T,>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T }

/** Every user's email, for labelling rows */
function useEmails() {
  return useLoad(async () => new Map((must(await supabase!.from('profiles').select('id,email')) as { id: string; email: string }[]).map(p => [p.id, p.email])))
}

function Overview() {
  const [days, setDays] = useState(30)
  const { data, error } = useLoad(async () => must(await supabase!.rpc('admin_stats', { days })) as Stats, [days])
  const max = Math.max(1, ...(data?.daily.map(d => d.events) ?? []))
  return <>
    <header className="ad-head"><h1>Overview</h1>
      <div className="ad-chips">{[7, 30, 90].map(d => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div></header>
    {error && <p className="ad-error">{error}</p>}
    {data && <>
      <div className="ad-cards">
        <Card label="Total users" value={data.users} />
        <Card label={`New users (${days}d)`} value={data.new_users} />
        <Card label={`Active users (${days}d)`} value={data.active_users} />
        <Card label="Cloud projects" value={data.projects} />
      </div>
      <section className="ad-panel">
        <h2>Daily activity</h2>
        {data.daily.length === 0 ? <p className="ad-muted">No activity yet.</p> : <svg className="ad-chart" viewBox={`0 0 ${data.daily.length * 22} 120`} preserveAspectRatio="none" role="img" aria-label="Events per day">
          {data.daily.map((d, i) => <rect key={d.day} x={i * 22 + 3} y={110 - (d.events / max) * 100} width={16} height={(d.events / max) * 100} rx={3}><title>{`${d.day}: ${d.events} events, ${d.users} users`}</title></rect>)}
        </svg>}
      </section>
      <section className="ad-panel">
        <h2>What people did</h2>
        <ul className="ad-rows">{Object.entries(data.by_type).sort((a, b) => b[1] - a[1]).map(([t, n]) => <li key={t}><span>{EVENT_NAMES[t] ?? t}</span><b>{n.toLocaleString()}</b></li>)}
          {Object.keys(data.by_type).length === 0 && <li><span className="ad-muted">Nothing recorded in this period.</span></li>}</ul>
      </section>
    </>}
  </>
}
const Card = ({ label, value }: { label: string; value: number }) => <div className="ad-card"><small>{label}</small><b>{value.toLocaleString()}</b></div>

function UsersSection() {
  const { data, error, reload } = useLoad(async () => must(await supabase!.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000)) as Profile[])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const shown = useMemo(() => (data ?? []).filter(u => !q || `${u.email} ${u.name}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const update = async (u: Profile, patch: Partial<Profile>) => {
    setMsg('')
    const r = await supabase!.from('profiles').update(patch).eq('id', u.id)
    if (r.error) setMsg(r.error.message); else reload()
  }
  return <>
    <header className="ad-head"><h1>Users <small>{data?.length ?? ''}</small></h1>
      <label className="ad-search"><Search size={14} /><input placeholder="Search email or name" value={q} onChange={e => setQ(e.target.value)} /></label></header>
    {(error || msg) && <p className="ad-error">{error || msg}</p>}
    <div className="ad-table-wrap"><table className="ad-table">
      <thead><tr><th>User</th><th>Joined</th><th>Last seen</th><th>Role</th><th>Status</th></tr></thead>
      <tbody>{shown.map(u => <tr key={u.id}>
        <td><b>{u.name || '—'}</b><small>{u.email}</small></td>
        <td>{when(u.created_at)}</td>
        <td>{u.last_seen ? when(u.last_seen) : '—'}</td>
        <td><select value={u.role} onChange={e => confirm(`Make ${u.email} ${e.target.value === 'admin' ? 'an admin' : 'a regular user'}?`) && update(u, { role: e.target.value as Profile['role'] })}><option value="user">User</option><option value="admin">Admin</option></select></td>
        <td><button className={`ad-pill ${u.banned ? 'bad' : 'good'}`} onClick={() => confirm(u.banned ? `Restore access for ${u.email}?` : `Block ${u.email}? They won’t be able to use cloud features.`) && update(u, { banned: !u.banned })}>{u.banned ? 'Blocked' : 'Active'}</button></td>
      </tr>)}</tbody>
    </table></div>
  </>
}

function ProjectsSection() {
  const emails = useEmails()
  const { data, error, reload } = useLoad(async () => must(await supabase!.from('projects').select('id,name,user_id,updated_at,duration').order('updated_at', { ascending: false }).limit(300)) as ProjectRow[])
  const remove = async (p: ProjectRow) => {
    if (!confirm(`Delete “${p.name}”? The owner will lose it. This can’t be undone.`)) return
    const r = await supabase!.from('projects').delete().eq('id', p.id)
    if (r.error) alert(r.error.message); else reload()
  }
  return <>
    <header className="ad-head"><h1>Projects <small>{data?.length ?? ''}</small></h1></header>
    {error && <p className="ad-error">{error}</p>}
    <div className="ad-table-wrap"><table className="ad-table">
      <thead><tr><th>Project</th><th>Owner</th><th>Length</th><th>Updated</th><th /></tr></thead>
      <tbody>{(data ?? []).map(p => <tr key={p.id}>
        <td><b>{p.name}</b></td><td>{emails.data?.get(p.user_id) ?? '—'}</td>
        <td>{Math.floor(p.duration / 60)}:{String(Math.round(p.duration % 60)).padStart(2, '0')}</td><td>{when(p.updated_at)}</td>
        <td><button className="ad-icon" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}><Trash2 size={14} /></button></td>
      </tr>)}</tbody>
    </table></div>
  </>
}

function StickersSection() {
  const { data, error, reload } = useLoad(async () => must(await supabase!.from('stickers').select('*').order('created_at', { ascending: false })) as StickerRow[])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const url = (p: string) => supabase!.storage.from('stickers').getPublicUrl(p).data.publicUrl
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setMsg('')
    try {
      for (const f of files) {
        const path = `${crypto.randomUUID()}.${f.name.split('.').pop()?.toLowerCase() || 'png'}`
        const up = await supabase!.storage.from('stickers').upload(path, f, { contentType: f.type })
        if (up.error) throw new Error(up.error.message)
        must(await supabase!.from('stickers').insert({ name: f.name.replace(/\.[^.]+$/, ''), path, tags: [] }))
      }
      reload()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Upload failed.') } finally { setBusy(false) }
  }
  const toggle = async (s: StickerRow) => { await supabase!.from('stickers').update({ published: !s.published }).eq('id', s.id); reload() }
  const remove = async (s: StickerRow) => {
    if (!confirm(`Delete the sticker “${s.name}” for everyone?`)) return
    await supabase!.storage.from('stickers').remove([s.path]); await supabase!.from('stickers').delete().eq('id', s.id); reload()
  }
  return <>
    <header className="ad-head"><h1>Sticker library <small>{data?.length ?? ''}</small></h1>
      <label className="cl-btn primary"><Upload size={14} /> {busy ? 'Uploading…' : 'Upload stickers'}<input type="file" hidden multiple accept="image/png,image/webp,image/gif" onChange={e => { upload(e.target.files); e.target.value = '' }} /></label></header>
    <p className="ad-muted">Stickers you publish here appear for every user under Stickers → Library. Only upload images you own or are licensed to share.</p>
    {(error || msg) && <p className="ad-error">{error || msg}</p>}
    <div className="ad-stickers">{(data ?? []).map(s => <figure key={s.id} className={s.published ? '' : 'draft'}>
      <img src={url(s.path)} alt={s.name} loading="lazy" />
      <figcaption>{s.name}</figcaption>
      <div><button className={`ad-pill ${s.published ? 'good' : ''}`} onClick={() => toggle(s)}>{s.published ? 'Published' : 'Hidden'}</button><button className="ad-icon" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}><Trash2 size={13} /></button></div>
    </figure>)}</div>
  </>
}

function ActivitySection() {
  const emails = useEmails()
  const [type, setType] = useState('')
  const { data, error } = useLoad(async () => {
    let q = supabase!.from('events').select('*').order('created_at', { ascending: false }).limit(200)
    if (type) q = q.eq('type', type)
    return must(await q) as Event[]
  }, [type])
  return <>
    <header className="ad-head"><h1>Activity</h1>
      <select className="ad-select" value={type} onChange={e => setType(e.target.value)}><option value="">Everything</option>{Object.entries(EVENT_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></header>
    {error && <p className="ad-error">{error}</p>}
    <div className="ad-table-wrap"><table className="ad-table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
      <tbody>{(data ?? []).map(e => <tr key={e.id}>
        <td>{when(e.created_at)}</td><td>{e.user_id ? emails.data?.get(e.user_id) ?? '—' : 'Guest'}</td><td>{EVENT_NAMES[e.type] ?? e.type}</td>
        <td><small>{Object.entries(e.meta).map(([k, v]) => `${k}: ${v}`).join(' · ')}</small></td>
      </tr>)}</tbody>
    </table></div>
  </>
}

function SettingsSection() {
  const [giphy, setGiphy] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => { supabase!.from('app_config').select('value').eq('key', 'giphy_key').maybeSingle().then(r => setGiphy((r.data as { value: string } | null)?.value ?? '')) }, [])
  const save = async () => {
    const r = await supabase!.from('app_config').upsert({ key: 'giphy_key', value: giphy.trim(), updated_at: new Date().toISOString() })
    setSaved(r.error ? r.error.message : 'Saved. Signed-in users get GIPHY search without entering a key.')
  }
  return <>
    <header className="ad-head"><h1>Settings</h1></header>
    <section className="ad-panel">
      <h2>GIPHY</h2>
      <p className="ad-muted">The API key used for sticker and GIF search. Get one free at developers.giphy.com. It is visible to the app’s users, as GIPHY keys always are, so use a key made for this app.</p>
      <input className="cl-input" placeholder="GIPHY API key" value={giphy} onChange={e => setGiphy(e.target.value)} />
      <button className="cl-btn primary block" onClick={save}>Save</button>
      {saved && <p className="ad-muted">{saved}</p>}
    </section>
  </>
}
