import { useState } from 'react'
import { Captions } from 'lucide-react'
import { cancelTranscribe, canRunHeavy, CAPTION_TRACK, type CaptionOptions, captionClips, LANGUAGES, MODELS, type Progress, restyle, transcribe } from './captions'
import { type Clip, projectDuration, type Project, type Track } from './model'
import { BASE_TEXT, TEXT_TEMPLATES } from './text'
import { track } from '../cloud/supabase'

const STYLES = ['caption', 'box', 'highlight', 'meme', 'pill', 'neon', 'bold']
const name = (id?: string) => LANGUAGES.find(l => l.id === id)?.label.split(' ').pop() ?? 'the speech'
const LENGTHS = [{ words: 2, label: 'Punchy (1–2 words)' }, { words: 4, label: 'Standard (3–4 words)' }, { words: 8, label: 'Full lines' }]

function load(): CaptionOptions {
  const base: CaptionOptions = { spoken: 'auto', language: 'en', quality: 'accurate', skipMusic: true, words: 4, style: 'caption' }
  try { return { ...base, ...JSON.parse(localStorage.getItem('lightup-captions') || '{}') } } catch { return base }
}

export function CaptionsDialog({ project, onClose, onApply }: { project: Project; onClose: () => void; onApply: (track: Track, clips: Clip[]) => void }) {
  const [o, setO] = useState<CaptionOptions>(load)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const heavyOk = canRunHeavy()
  const blocked = !heavyOk && (o.spoken === 'hi' || o.spoken === 'te' || o.language !== (o.spoken === 'auto' ? 'en' : o.spoken))
  const has = project.clips.some(c => c.trackId === CAPTION_TRACK.id)
  const set = (p: Partial<CaptionOptions>) => setO(x => { const n = { ...x, ...p }; try { localStorage.setItem('lightup-captions', JSON.stringify(n)) } catch { /* private mode */ } return n })

  const run = async () => {
    setError(''); setProgress({ stage: 'audio' })
    try {
      const chunks = await transcribe(project, o, setProgress)
      const clips = captionClips(chunks, o, projectDuration(project))
      if (!clips.length) throw new Error('No speech was found. Check the language and that the voice track isn’t muted.')
      onApply(CAPTION_TRACK, clips)
      track('captions', { spoken: o.spoken, language: o.language, quality: o.quality, count: clips.length })
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Captions failed.') }
    finally { setProgress(null) }
  }
  const cancel = () => { cancelTranscribe(); setProgress(null); onClose() }

  return <div className="ed-modal-back" onMouseDown={() => !progress && onClose()}>
    <div className="ed-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Auto captions">
      <h2>Auto captions</h2>
      {progress ? <>
        <p>{progress.stage === 'audio' ? 'Preparing your audio…'
          : progress.stage === 'download' ? `Downloading the speech model (${progress.mb ?? '…'} MB, only the first time)…`
          : progress.stage === 'download-translator' ? `Heard ${name(progress.heard)}. Downloading the translation model (${progress.mb ?? '…'} MB, only the first time)…`
          : progress.stage === 'translating' ? `Heard ${name(progress.heard)}. Translating into ${name(o.language)}…`
          : 'Listening to your video… this takes about as long as the video, or less.'}</p>
        <div className="ed-bar">{progress.stage.startsWith('download') ? <i style={{ width: `${Math.round((progress.share ?? 0) * 100)}%` }} /> : <i className="indeterminate" />}</div>
        <p className="ed-pct">Runs on this device. Your audio isn’t uploaded.</p>
        <button className="ed-btn block" onClick={cancel}>Cancel</button>
      </> : <>
        <p>Turns speech into on-screen captions you can edit, right on this device.</p>
        <div className="ed-field"><span>Language spoken in the video</span><div className="ed-chips big">{[{ id: 'auto' as const, label: 'Detect' }, ...LANGUAGES].map(l => <button key={l.id} className={o.spoken === l.id ? 'on' : ''} onClick={() => set({ spoken: l.id })}>{l.label}</button>)}</div></div>
        <div className="ed-field"><span>Write captions in</span><div className="ed-chips big">{LANGUAGES.map(l => <button key={l.id} className={o.language === l.id ? 'on' : ''} onClick={() => set({ language: l.id })}>{l.label}</button>)}</div>
          <small className="ed-note">If it differs from the spoken language, the captions are translated on this device (the translation model is about 900 MB and downloads once).</small></div>
        <div className="ed-field"><span>Caption length</span><div className="ed-chips">{LENGTHS.map(l => <button key={l.words} className={o.words === l.words ? 'on' : ''} onClick={() => set({ words: l.words })}>{l.label}</button>)}</div></div>
        <div className="ed-field"><span>Style</span><div className="ed-templates">{STYLES.map(id => { const t = TEXT_TEMPLATES.find(x => x.id === id)!; const s = { ...BASE_TEXT, ...t.spec }; return <button key={id} className={o.style === id ? 'on' : ''} title={t.name} onClick={() => set({ style: id })} style={{ fontFamily: `"${s.font}"`, fontWeight: s.weight, color: s.color, background: s.bg !== 'none' ? s.bgColor : undefined, WebkitTextStroke: s.stroke ? `${s.stroke * 1.5}px ${s.strokeColor}` : undefined, textTransform: s.uppercase ? 'uppercase' : undefined }}>Aa<small>{t.name}</small></button> })}</div></div>
        {o.spoken !== 'hi' && o.spoken !== 'te' && <div className="ed-field"><span>{o.spoken === 'en' ? 'Accuracy' : 'Accuracy for English speech'}</span><div className="ed-chips big">{(Object.keys(MODELS) as (keyof typeof MODELS)[]).map(k => <button key={k} className={o.quality === k ? 'on' : ''} onClick={() => set({ quality: k })}>{MODELS[k].label} <small>{MODELS[k].size}</small></button>)}</div>
</div>}
        {o.spoken !== 'en' && <small className="ed-note">Hindi and Telugu speech always uses the most accurate model (about 600 MB, downloads once): the smaller ones get these languages wrong.</small>}
        <label className="ed-toggle"><span>Ignore the Music track<small>Background music makes speech harder to hear</small></span><input type="checkbox" checked={o.skipMusic} onChange={e => set({ skipMusic: e.target.checked })} /><i /></label>
        {blocked && <p className="ed-error">Telugu, Hindi and translated captions need a laptop or desktop with plenty of memory. On this device they can freeze it, so they’re turned off. English captions work here.</p>}
        {error && <p className="ed-error">{error}</p>}
        <button className="ed-btn primary block" disabled={blocked} onClick={run}><Captions size={15} /> {has ? 'Regenerate captions' : 'Generate captions'}</button>
        {has && <button className="ed-btn block" onClick={() => { onApply(CAPTION_TRACK, restyle(project, o.style)); onClose() }}>Just restyle my captions</button>}
        <button className="ed-btn block" onClick={onClose}>Cancel</button>
      </>}
    </div>
  </div>
}
