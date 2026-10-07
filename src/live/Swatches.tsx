import { HUE_IDS, hueColor, type Hue } from './rig'

export const HUE_NAMES: Record<Hue, string> = { red: 'Red', orange: 'Orange', pink: 'Pink', purple: 'Purple', blue: 'Blue', cyan: 'Cyan', green: 'Green', cycle: 'Rainbow' }

/** RGB colour dots; the first one is the "no colour" choice */
export function Swatches<T extends string>({ value, none, onPick }: { value: Hue | T; none: { id: T; name: string }; onPick: (v: Hue | T) => void }) {
  const css = (h: Hue) => { const [r, g, b] = hueColor(h, 0); return `rgb(${r * 255},${g * 255},${b * 255})` }
  return <div className="swatches" role="radiogroup">
    {[none.id, ...HUE_IDS].map(id => <button key={id} type="button" role="radio" aria-checked={value === id} aria-label={id === none.id ? none.name : HUE_NAMES[id as Hue]} title={id === none.id ? none.name : HUE_NAMES[id as Hue]}
      className={`dot ${id} ${value === id ? 'on' : ''}`} style={id === none.id || id === 'cycle' ? undefined : { background: css(id as Hue) }} onClick={() => onPick(id)} />)}
  </div>
}
