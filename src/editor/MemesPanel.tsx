import { Smile } from 'lucide-react'

const REACTIONS = ['😂', '💀', '🤯', '😎', '🔥', '😭', '🥶', '👀', '💯', '😱', '🤡', '🫡', '🙏', '🤌', '👑', '💸', '✨', '❤️', '🤣', '😈', '🥵', '🤐', '🫠', '😴', '🥳', '🤝', '👏', '🚨']
const CAPTIONS = [
  { label: 'Top & bottom text', lines: [{ text: 'WHEN YOU…', y: 0.1 }, { text: '…AND IT WORKS', y: 0.9 }] },
  { label: 'POV:', lines: [{ text: 'POV: ', y: 0.14 }] },
  { label: 'Nobody:', lines: [{ text: 'Nobody:\nMe:', y: 0.16 }] },
  { label: 'Wait for it…', lines: [{ text: 'WAIT FOR IT…', y: 0.12 }] },
  { label: 'Me when…', lines: [{ text: 'ME WHEN', y: 0.88 }] },
  { label: 'Not me 💀', lines: [{ text: 'NOT ME 💀', y: 0.88 }] },
]

/** An emoji drawn onto a transparent picture, so it can sit on the timeline like any sticker */
export async function emojiFile(emoji: string): Promise<File> {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(emoji, 128, 140)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('Couldn’t make that sticker.')
  return new File([blob], `${emoji}.png`, { type: 'image/png' })
}

/** Meme captions and reaction stickers */
export function MemesPanel({ onSticker, onText, onEyes }: { onSticker: (f: File) => void; onText: (lines: { text: string; y: number }[]) => void; onEyes: () => void }) {
  return <>
    <div className="ed-side-head"><b>Meme text</b><small className="ed-note">Added at the playhead</small></div>
    <div className="ed-chips" style={{ marginBottom: 16 }}>{CAPTIONS.map(c => <button key={c.label} onClick={() => onText(c.lines)}>{c.label}</button>)}</div>
    <div className="ed-side-head"><b>Reactions</b><small className="ed-note">Tap to add</small></div>
    <div className="ed-emoji">{REACTIONS.map(e => <button key={e} aria-label={`Add ${e}`} onClick={async () => onSticker(await emojiFile(e))}>{e}</button>)}</div>
    <button className="ed-btn block" onClick={onEyes}><Smile size={14} /> “Deal with it” shades &amp; eye effects</button>
    <small className="ed-note" style={{ display: 'block', marginTop: 8 }}>Select a video or photo of a face, then use Effects → Eye effects. Meme sounds are in the Sounds tab.</small>
  </>
}
