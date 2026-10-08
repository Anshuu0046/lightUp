import { type Asset, type AssetKind, type Project, projectDuration, uid } from './model'
import { waveImage } from './audio'
import { frameCount } from './anim'

/** The actual files behind assets. Kept outside the project document so undo history stays small. */
const files = new Map<string, { file: Blob; url: string }>()

export const fileOf = (id: string) => files.get(id)?.file
/** Registers a file that came from elsewhere (the cloud) under an asset id; returns its local URL */
export const adoptFile = (id: string, file: Blob) => { remember(id, file); return urlOf(id) }
export const urlOf = (id: string) => files.get(id)?.url ?? ''

function remember(id: string, file: Blob) {
  const prev = files.get(id)
  if (prev) URL.revokeObjectURL(prev.url)
  files.set(id, { file, url: URL.createObjectURL(file) })
}

const kindOf = (f: File): AssetKind | null =>
  f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : null

const once = (el: EventTarget, ok: string) => new Promise<void>((res, rej) => {
  el.addEventListener(ok, () => res(), { once: true })
  el.addEventListener('error', () => rej(new Error('This file could not be opened.')), { once: true })
})

/** Reads a dropped or picked file into an asset: its length, size, whether it has sound, and a thumbnail */
export async function importFile(f: File): Promise<Asset> {
  const kind = kindOf(f)
  if (!kind) throw new Error(`“${f.name}” isn’t a video, photo or audio file.`)
  const id = uid()
  remember(id, f)
  const url = urlOf(id)
  const base = { id, kind, name: f.name.replace(/\.[^.]+$/, ''), duration: 0, width: 0, height: 0, hasAudio: kind !== 'image', thumb: '' }
  if (kind === 'image') {
    const img = new Image(); img.src = url; await once(img, 'load')
    const anim = await frameCount(f)
    return { ...base, width: img.naturalWidth, height: img.naturalHeight, thumb: url, animated: anim.frames > 1, duration: anim.seconds }
  }
  if (kind === 'audio') {
    const a = new Audio(); a.preload = 'metadata'; a.src = url; await once(a, 'loadedmetadata')
    return { ...base, duration: a.duration, wave: await waveOf(f) }
  }
  const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.src = url
  await once(v, 'loadedmetadata')
  v.currentTime = Math.min(0.5, v.duration / 3); await once(v, 'seeked')
  const c = document.createElement('canvas'); const s = 160 / Math.max(v.videoWidth, v.videoHeight)
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s)
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  const sound = await hasAudioTrack(f)
  return { ...base, duration: v.duration, width: v.videoWidth, height: v.videoHeight, hasAudio: sound, thumb: c.toDataURL('image/jpeg', 0.7), wave: sound ? await waveOf(f) : undefined }
}

/** Draws the file's waveform once, for the timeline (skipped for very large files to keep import quick) */
async function waveOf(f: Blob) {
  if (f.size > 400e6) return undefined
  try { return waveImage(await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await f.arrayBuffer())) } catch { return undefined }
}

/** Browsers don't say whether a video has sound, so look inside the file */
async function hasAudioTrack(f: File) {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny')
    const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS })
    const track = await input.getPrimaryAudioTrack()
    input.dispose?.()
    return !!track
  } catch { return true }
}

// ---------- saving: the project and its files live in IndexedDB, so a reload never loses work ----------

const DB = 'lightup-editor', STORE = 'kv'
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode); const req = run(t.objectStore(STORE))
    t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error)
  })
}

/** What the project list shows, kept apart from the project so listing never has to read a whole document */
export type ProjectMeta = { id: string; name: string; updated: number; duration: number; clips: number; thumb: string }

const CURRENT = 'lightup-current-project'
export const currentId = () => { try { return localStorage.getItem(CURRENT) } catch { return null } }
export const setCurrentId = (id: string) => { try { localStorage.setItem(CURRENT, id) } catch { /* private mode */ } }

/** An empty project isn't worth a place in the list */
export const isEmpty = (p: Project) => !p.assets.length && !p.clips.length

/** Older versions kept one project under the key "project"; it becomes the first entry in the list */
async function migrate() {
  const old = await tx<Project>('readonly', s => s.get('project'))
  if (!old) return
  const id = uid()
  await saveProject(id, old)
  await tx('readwrite', s => { s.delete('project') })
  if (!currentId()) setCurrentId(id)
}

export async function saveProject(id: string, p: Project) {
  const stored = new Set((await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())) ?? [])
  const first = p.assets.find(a => a.kind === 'video' && a.thumb)
  const meta: ProjectMeta = { id, name: p.name, updated: Date.now(), duration: projectDuration(p), clips: p.clips.length, thumb: first?.thumb ?? '' }
  await tx('readwrite', s => {
    s.put(p, 'proj:' + id)
    s.put(meta, 'meta:' + id)
    for (const a of p.assets) if (!stored.has('file:' + a.id) && files.has(a.id)) s.put(files.get(a.id)!.file, 'file:' + a.id)
  })
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await migrate().catch(() => {})
  const all = (await tx<ProjectMeta[]>('readonly', s => s.getAll(IDBKeyRange.bound('meta:', 'meta:\uffff')))) ?? []
  return all.sort((a, b) => b.updated - a.updated)
}

export async function loadProject(id: string): Promise<Project | undefined> {
  try {
    const p = await tx<Project>('readonly', s => s.get('proj:' + id))
    if (!p) return undefined
    for (const a of p.assets) {
      const f = await tx<Blob>('readonly', s => s.get('file:' + a.id))
      if (f) { remember(a.id, f); if (a.kind === 'image') a.thumb = urlOf(a.id) }
    }
    return { ...p, assets: p.assets.filter(a => files.has(a.id)), clips: p.clips.filter(c => files.has(c.assetId)) }
  } catch { return undefined }
}

export async function renameProject(id: string, name: string) {
  const p = await tx<Project>('readonly', s => s.get('proj:' + id))
  const m = await tx<ProjectMeta>('readonly', s => s.get('meta:' + id))
  if (!p || !m) return
  await tx('readwrite', s => { s.put({ ...p, name }, 'proj:' + id); s.put({ ...m, name }, 'meta:' + id) })
}

/** A copy shares the original's media files (they're stored once, by asset id) */
export async function duplicateProject(id: string): Promise<string | undefined> {
  const p = await tx<Project>('readonly', s => s.get('proj:' + id))
  const m = await tx<ProjectMeta>('readonly', s => s.get('meta:' + id))
  if (!p || !m) return undefined
  const copy = uid(), name = `${p.name} copy`
  await tx('readwrite', s => { s.put({ ...p, name }, 'proj:' + copy); s.put({ ...m, id: copy, name, updated: Date.now() }, 'meta:' + copy) })
  return copy
}

export async function deleteProject(id: string) {
  await tx('readwrite', s => { s.delete('proj:' + id); s.delete('meta:' + id) })
  await forgetUnusedFiles()
}

/** Removes stored media that no project uses any more */
export async function forgetUnusedFiles() {
  const projects = (await tx<Project[]>('readonly', s => s.getAll(IDBKeyRange.bound('proj:', 'proj:\uffff')))) ?? []
  const used = new Set(projects.flatMap(p => p.assets.map(a => 'file:' + a.id)))
  const keys = (await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())) ?? []
  const orphans = keys.filter(k => typeof k === 'string' && k.startsWith('file:') && !used.has(k))
  if (orphans.length) await tx('readwrite', s => { for (const k of orphans) s.delete(k) })
}
