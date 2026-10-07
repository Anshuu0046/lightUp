import { useEffect, useRef, useState } from 'react'
import { Search, Upload, X } from 'lucide-react'
import { deleteSticker, download, giphyKey, type Kind, libraryStickers, loadSharedKey, myStickers, type MySticker, saveSticker, searchGiphy, setGiphyKey, type StickerResult } from './stickers'
import { cloudEnabled } from '../cloud/supabase'

/** Stickers and GIFs from GIPHY, plus "My stickers": a library the user uploads to, shared across projects */
export function StickersPanel({ onAdd, onError }: { onAdd: (f: File) => Promise<void>; onError: (m: string) => void }) {
  const [source, setSource] = useState<'giphy' | 'mine' | 'library'>('giphy')
  return <>
    <div className="ed-chips ed-sources">
      <button className={source === 'giphy' ? 'on' : ''} onClick={() => setSource('giphy')}>GIPHY</button>
      {cloudEnabled && <button className={source === 'library' ? 'on' : ''} onClick={() => setSource('library')}>Library</button>}
      <button className={source === 'mine' ? 'on' : ''} onClick={() => setSource('mine')}>Mine</button>
    </div>
    {source === 'giphy' ? <Giphy onAdd={onAdd} onError={onError} /> : source === 'library' ? <Library onAdd={onAdd} onError={onError} /> : <Mine onAdd={onAdd} onError={onError} />}
  </>
}

function Giphy({ onAdd, onError }: { onAdd: (f: File) => Promise<void>; onError: (m: string) => void }) {
  const [key, setKey] = useState(giphyKey)
  useEffect(() => { if (!key) loadSharedKey().then(k => k && setKey(k)).catch(() => {}) }, [])
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<Kind>('stickers')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<StickerResult[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [adding, setAdding] = useState('')
  const timer = useRef(0)

  useEffect(() => {
    if (!key) return
    clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setState('loading')
      try { setItems(await searchGiphy(q, kind)); setState('idle') }
      catch (e) {
        const m = e instanceof Error ? e.message : ''
        if (m === 'bad-key') { setGiphyKey(''); setKey(''); onError('That GIPHY key was rejected. Check it and paste it again.') }
        setState('error')
      }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [q, kind, key])

  if (!key) return <div className="ed-card">
    <b className="ed-card-title">Connect GIPHY</b>
    <p className="ed-note">Search millions of licensed stickers and reaction GIFs. Paste a free API key from developers.giphy.com (create an app, choose “API”).</p>
    <input className="ed-input" placeholder="GIPHY API key" value={draft} onChange={e => setDraft(e.target.value)} />
    <button className="ed-btn primary block" disabled={!draft.trim()} onClick={() => { setGiphyKey(draft); setKey(draft.trim()) }}>Connect</button>
  </div>

  const add = async (s: StickerResult) => {
    setAdding(s.id)
    try { await onAdd(await download(s)) } catch (e) { onError(e instanceof Error ? e.message : 'Couldn’t add that sticker.') }
    finally { setAdding('') }
  }

  return <>
    <label className="ed-search"><Search size={14} /><input placeholder={kind === 'stickers' ? 'Search stickers' : 'Search GIFs and memes'} value={q} onChange={e => setQ(e.target.value)} /></label>
    <div className="ed-chips ed-sources small">
      <button className={kind === 'stickers' ? 'on' : ''} onClick={() => setKind('stickers')}>Stickers</button>
      <button className={kind === 'gifs' ? 'on' : ''} onClick={() => setKind('gifs')}>GIFs & memes</button>
    </div>
    {state === 'error' && <p className="ed-note">GIPHY couldn’t be reached. Check your connection.</p>}
    <div className={`ed-stickers ${state === 'loading' ? 'loading' : ''}`}>
      {items.map(s => <button key={s.id} title={`Add “${s.title}”`} onClick={() => add(s)} disabled={!!adding}>
        <img src={s.preview} alt={s.title} loading="lazy" />{adding === s.id && <span className="ed-spin" />}
      </button>)}
    </div>
    <p className="ed-attribution">Powered by GIPHY</p>
  </>
}

function Library({ onAdd, onError }: { onAdd: (f: File) => Promise<void>; onError: (m: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; url: string }[] | null>(null)
  const [adding, setAdding] = useState('')
  useEffect(() => { libraryStickers().then(setList).catch(() => onError('Couldn’t load the sticker library.')) }, [])
  const add = async (s: { id: string; name: string; url: string }) => {
    setAdding(s.id)
    try { const b = await (await fetch(s.url)).blob(); await onAdd(new File([b], s.name, { type: b.type })) } catch { onError('Couldn’t add that sticker.') } finally { setAdding('') }
  }
  if (!list) return <p className="ed-note">Loading…</p>
  if (!list.length) return <p className="ed-note">No shared stickers yet. Admins can publish some from the admin panel.</p>
  return <div className="ed-stickers">{list.map(s => <button key={s.id} title={`Add ${s.name}`} disabled={!!adding} onClick={() => add(s)}><img src={s.url} alt={s.name} loading="lazy" />{adding === s.id && <span className="ed-spin" />}</button>)}</div>
}

function Mine({ onAdd, onError }: { onAdd: (f: File) => Promise<void>; onError: (m: string) => void }) {
  const [list, setList] = useState<(MySticker & { url: string })[]>([])
  const input = useRef<HTMLInputElement>(null)
  const refresh = () => myStickers().then(s => setList(prev => { prev.forEach(p => URL.revokeObjectURL(p.url)); return s.map(x => ({ ...x, url: URL.createObjectURL(x.file) })) })).catch(() => onError('Couldn’t open your sticker library.'))
  useEffect(() => { refresh() }, [])

  return <>
    <button className="ed-btn block" onClick={() => input.current?.click()}><Upload size={14} /> Upload stickers</button>
    <input ref={input} type="file" accept="image/png,image/webp,image/gif,image/svg+xml" multiple hidden onChange={async e => { for (const f of e.target.files ?? []) await saveSticker(f); e.target.value = ''; refresh() }} />
    {list.length === 0 ? <p className="ed-note">Upload PNGs with transparent backgrounds, or animated GIFs and WebPs. They’re saved on this device for every project.</p>
      : <div className="ed-stickers">{list.map(s => <div key={s.id} className="ed-mine">
          <button title={`Add ${s.name}`} onClick={() => onAdd(new File([s.file], s.name, { type: s.file.type }))}><img src={s.url} alt={s.name} /></button>
          <button className="ed-del" aria-label={`Delete ${s.name}`} onClick={async () => { await deleteSticker(s.id); refresh() }}><X size={12} /></button>
        </div>)}</div>}
  </>
}

