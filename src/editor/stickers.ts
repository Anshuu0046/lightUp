/**
 * Stickers and GIFs: search GIPHY (licensed, with its API key) and a personal library the user uploads to.
 * Anything added to a project is downloaded and stored with it, so it keeps working offline.
 */

export type StickerResult = { id: string; title: string; preview: string; full: string; type: string }
export type Kind = 'stickers' | 'gifs'

const KEY_STORE = 'lightup-giphy-key'
let sharedKey = ''
export const giphyKey = () => (import.meta.env.VITE_GIPHY_KEY as string | undefined) || localStorage.getItem(KEY_STORE) || sharedKey
/** Picks up the GIPHY key an admin saved in the admin panel (signed-in users only) */
export async function loadSharedKey() {
  const { supabase } = await import('../cloud/supabase')
  if (!supabase || giphyKey()) return giphyKey()
  const { data } = await supabase.from('app_config').select('value').eq('key', 'giphy_key').maybeSingle()
  sharedKey = (data as { value: string } | null)?.value ?? ''
  return giphyKey()
}

/** Stickers admins published to everyone */
export async function libraryStickers(): Promise<{ id: string; name: string; url: string }[]> {
  const { supabase } = await import('../cloud/supabase')
  if (!supabase) return []
  const { data } = await supabase.from('stickers').select('id,name,path').eq('published', true).order('created_at', { ascending: false }).limit(300)
  return ((data ?? []) as { id: string; name: string; path: string }[]).map(s => ({ id: s.id, name: s.name, url: supabase.storage.from('stickers').getPublicUrl(s.path).data.publicUrl }))
}
export const setGiphyKey = (k: string) => { try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE) } catch { /* private mode */ } }

type GiphyItem = { id: string; title: string; images: Record<string, { url?: string; webp?: string; width?: string }> }

/** Search (or trending when `q` is empty). Uses WebP renditions: smaller than GIF, with real transparency. */
export async function searchGiphy(q: string, kind: Kind, offset = 0): Promise<StickerResult[]> {
  const key = giphyKey()
  if (!key) throw new Error('missing-key')
  const path = q.trim() ? 'search' : 'trending'
  const url = `https://api.giphy.com/v1/${kind}/${path}?api_key=${encodeURIComponent(key)}&limit=24&offset=${offset}&rating=pg-13&bundle=messaging_non_clips${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`
  const r = await fetch(url)
  if (r.status === 401 || r.status === 403) throw new Error('bad-key')
  if (!r.ok) throw new Error('GIPHY isn’t responding right now. Try again in a moment.')
  const { data } = await r.json() as { data: GiphyItem[] }
  return data.map(d => {
    const small = d.images.fixed_width_small ?? d.images.fixed_width
    const big = d.images.fixed_height ?? d.images.original
    const full = big.webp ?? big.url!
    return { id: d.id, title: d.title || 'GIPHY', preview: small.webp ?? small.url!, full, type: big.webp ? 'image/webp' : 'image/gif' }
  })
}

export async function download(s: StickerResult): Promise<File> {
  const r = await fetch(s.full)
  if (!r.ok) throw new Error('Couldn’t download that sticker.')
  const b = await r.blob()
  return new File([b], `${s.title.slice(0, 40) || 'sticker'}.${s.type === 'image/webp' ? 'webp' : 'gif'}`, { type: b.type || s.type })
}

// ---------- the user's own sticker library, shared across projects ----------

export type MySticker = { id: string; name: string; file: Blob }
const DB = 'lightup-stickers'
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('s', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
export async function myStickers(): Promise<MySticker[]> {
  const d = await db()
  return new Promise((res, rej) => { const q = d.transaction('s').objectStore('s').getAll(); q.onsuccess = () => res(q.result as MySticker[]); q.onerror = () => rej(q.error) })
}
export async function saveSticker(f: File) {
  const d = await db()
  await new Promise<void>((res, rej) => { const t = d.transaction('s', 'readwrite'); t.objectStore('s').put({ id: crypto.randomUUID(), name: f.name, file: f }); t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
}
export async function deleteSticker(id: string) {
  const d = await db()
  await new Promise<void>((res, rej) => { const t = d.transaction('s', 'readwrite'); t.objectStore('s').delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
}
