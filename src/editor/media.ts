import { type Asset, type AssetKind, type Project, uid } from './model'

/** The actual files behind assets. Kept outside the project document so undo history stays small. */
const files = new Map<string, { file: Blob; url: string }>()

export const fileOf = (id: string) => files.get(id)?.file
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
    return { ...base, width: img.naturalWidth, height: img.naturalHeight, thumb: url }
  }
  if (kind === 'audio') {
    const a = new Audio(); a.preload = 'metadata'; a.src = url; await once(a, 'loadedmetadata')
    return { ...base, duration: a.duration }
  }
  const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.src = url
  await once(v, 'loadedmetadata')
  v.currentTime = Math.min(0.5, v.duration / 3); await once(v, 'seeked')
  const c = document.createElement('canvas'); const s = 160 / Math.max(v.videoWidth, v.videoHeight)
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s)
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  return { ...base, duration: v.duration, width: v.videoWidth, height: v.videoHeight, hasAudio: await hasAudioTrack(f), thumb: c.toDataURL('image/jpeg', 0.7) }
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

export async function saveProject(p: Project) {
  const stored = new Set((await tx<IDBValidKey[]>('readonly', s => s.getAllKeys())) ?? [])
  await tx('readwrite', s => {
    s.put(p, 'project')
    for (const a of p.assets) if (!stored.has('file:' + a.id) && files.has(a.id)) s.put(files.get(a.id)!.file, 'file:' + a.id)
    // forget files no asset uses any more
    for (const k of stored) if (typeof k === 'string' && k.startsWith('file:') && !p.assets.some(a => 'file:' + a.id === k)) s.delete(k)
  })
}

export async function loadProject(): Promise<Project | undefined> {
  try {
    const p = await tx<Project>('readonly', s => s.get('project'))
    if (!p) return undefined
    for (const a of p.assets) {
      const f = await tx<Blob>('readonly', s => s.get('file:' + a.id))
      if (f) { remember(a.id, f); if (a.kind === 'image') a.thumb = urlOf(a.id) }
    }
    return { ...p, assets: p.assets.filter(a => files.has(a.id)), clips: p.clips.filter(c => files.has(c.assetId)) }
  } catch { return undefined }
}

export const clearSaved = () => tx('readwrite', s => s.clear())
