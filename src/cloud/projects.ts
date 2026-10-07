import { supabase } from './supabase'
import type { Project } from '../editor/model'
import { adoptFile, fileOf } from '../editor/media'

export type CloudProject = { id: string; name: string; updated_at: string; duration: number }

const uploadedKey = (id: string) => `lightup-uploaded:${id}`
const uploaded = (id: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(uploadedKey(id)) || '[]')) } catch { return new Set() } }

/** Saves the project to the user's account: media files go to private storage (each only once), the document to the database */
export async function saveToCloud(p: Project, duration: number, cloudId: string | null, onProgress: (share: number) => void): Promise<string> {
  if (!supabase) throw new Error('Accounts aren’t set up.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to save to your account.')
  const id = cloudId ?? crypto.randomUUID()
  const done = uploaded(id)
  const todo = p.assets.filter(a => !done.has(a.id))
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i], f = fileOf(a.id)
    if (!f) continue
    const { error } = await supabase.storage.from('media').upload(`${session.user.id}/${id}/${a.id}`, f, { upsert: true, contentType: f.type || 'application/octet-stream' })
    if (error) throw new Error(`Couldn’t upload “${a.name}”: ${error.message}`)
    done.add(a.id)
    try { localStorage.setItem(uploadedKey(id), JSON.stringify([...done])) } catch { /* private mode */ }
    onProgress((i + 1) / (todo.length + 1))
  }
  // thumbnails of photos are object URLs on this device; they're rebuilt when the project is opened
  const doc = { ...p, assets: p.assets.map(a => (a.kind === 'image' ? { ...a, thumb: '' } : a)) }
  const { error } = await supabase.from('projects').upsert({ id, name: p.name, data: doc, duration, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
  onProgress(1)
  return id
}

export async function listCloud(): Promise<CloudProject[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('projects').select('id,name,updated_at,duration').order('updated_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  return data as CloudProject[]
}

/** Downloads a project and its media onto this device */
export async function openFromCloud(id: string, onProgress: (share: number) => void): Promise<Project> {
  if (!supabase) throw new Error('Accounts aren’t set up.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in first.')
  const { data, error } = await supabase.from('projects').select('data').eq('id', id).single()
  if (error) throw new Error(error.message)
  const p = data.data as Project
  for (let i = 0; i < p.assets.length; i++) {
    const a = p.assets[i]
    const { data: blob, error: e } = await supabase.storage.from('media').download(`${session.user.id}/${id}/${a.id}`)
    if (e || !blob) throw new Error(`Couldn’t download “${a.name}”.`)
    const url = adoptFile(a.id, blob)
    if (a.kind === 'image') a.thumb = url
    onProgress((i + 1) / p.assets.length)
  }
  try { localStorage.setItem(uploadedKey(id), JSON.stringify(p.assets.map(a => a.id))) } catch { /* private mode */ }
  return p
}

export async function deleteFromCloud(id: string) {
  if (!supabase) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  const { data } = await supabase.storage.from('media').list(`${session.user.id}/${id}`)
  if (data?.length) await supabase.storage.from('media').remove(data.map(f => `${session.user.id}/${id}/${f.name}`))
  await supabase.from('projects').delete().eq('id', id)
  try { localStorage.removeItem(uploadedKey(id)) } catch { /* private mode */ }
}
