import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type Light = 'ring' | 'window' | 'bulb' | 'rgb'

/** A sculpted bust, lit the way each light would light a person (drawn, so it's sharp at any size) */
export function Bust({ light, id, color = '#9d8cff', cover }: { light: Light; id: string; color?: string; /** fill the box, cropping the edges */ cover?: boolean }) {
  const SIL = 'M200,96 C252,96 286,138 286,198 C286,244 268,276 242,294 L246,336 C302,352 354,388 368,520 L32,520 C46,388 98,352 154,336 L158,294 C132,276 114,244 114,198 C114,138 148,96 200,96 Z'
  const key = { ring: { x: 200, y: 230, r: 300, c: '#f6dcc4' }, window: { x: 40, y: 170, r: 330, c: '#eef3ff' }, bulb: { x: 322, y: 430, r: 300, c: '#ffae5c' }, rgb: { x: 150, y: 180, r: 250, c: '#f3e3d6' } }[light]
  const wall = { ring: ['#2b2731', '#0c0b10'], window: ['#3b4252', '#0b0c10'], bulb: ['#4a2a12', '#08070a'], rgb: [color, '#09080d'] }[light]
  return <svg viewBox="0 0 400 520" className="bust" preserveAspectRatio={cover ? 'xMidYMid slice' : undefined} aria-hidden>
    <defs>
      <radialGradient id={`${id}-wall`} cx={light === 'window' ? '.15' : light === 'bulb' ? '.8' : light === 'rgb' ? '.78' : '.5'} cy={light === 'bulb' ? '.85' : '.3'} r=".85">
        <stop offset="0" className="tr" style={{ stopColor: wall[0] }} stopOpacity={light === 'rgb' ? 0.85 : 1} /><stop offset="1" stopColor={wall[1]} />
      </radialGradient>
      <radialGradient id={`${id}-key`} gradientUnits="userSpaceOnUse" cx={key.x} cy={key.y} r={key.r}>
        <stop offset="0" stopColor={key.c} stopOpacity=".95" /><stop offset=".5" stopColor={key.c} stopOpacity=".38" /><stop offset="1" stopColor={key.c} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-bulb`}><stop offset="0" stopColor="#fff2d6" /><stop offset=".25" stopColor="#ffb766" stopOpacity=".6" /><stop offset="1" stopColor="#ff8a2a" stopOpacity="0" /></radialGradient>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16" /></filter>
      <filter id={`${id}-softer`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="26" /></filter>
      <clipPath id={`${id}-clip`}><path d={SIL} /></clipPath>
    </defs>
    <rect width="400" height="520" fill={`url(#${id}-wall)`} />
    {light === 'window' && <g filter={`url(#${id}-softer)`} opacity=".55" transform="skewY(-8) translate(0 40)">
      {[0, 1].map(c => [0, 1].map(r => <rect key={`${c}${r}`} x={150 + c * 92} y={40 + r * 120} width="80" height="108" fill="#dfe8ff" />))}
    </g>}
    {/* a ring light leaves a thin soft shadow all around you on the wall */}
    {light === 'ring' && <path d={SIL} fill="#000" opacity=".55" filter={`url(#${id}-soft)`} transform="translate(200 300) scale(1.06) translate(-200 -300)" />}
    {light === 'window' && <path d={SIL} fill="#000" opacity=".5" filter={`url(#${id}-soft)`} transform="translate(34 6)" />}
    <path d={SIL} fill="#141118" />
    <g clipPath={`url(#${id}-clip)`}>
      <rect width="400" height="520" fill={`url(#${id}-key)`} style={{ mixBlendMode: 'screen' }} />
      {/* turn of the form: the edges roll away from the light */}
      <path d={SIL} fill="none" stroke="#050407" strokeWidth="60" opacity={light === 'window' ? 0.35 : 0.6} filter={`url(#${id}-soft)`} />
      {light === 'window' && <rect x="200" width="200" height="520" fill="#050407" opacity=".55" filter={`url(#${id}-softer)`} />}
      {light === 'rgb' && <path d={SIL} fill="none" className="tr" style={{ stroke: color }} strokeWidth="22" opacity=".95" filter={`url(#${id}-soft)`} transform="translate(8 0)" />}
      {light === 'bulb' && <circle cx="300" cy="400" r="90" fill="#ff7a2a" opacity=".45" filter={`url(#${id}-softer)`} />}
    </g>
    {light === 'bulb' && <g className="bulb-glow"><circle cx="322" cy="430" r="80" fill={`url(#${id}-bulb)`} /><circle cx="322" cy="430" r="11" fill="#fff8ea" /></g>}
  </svg>
}

const pictures = new Map<string, string>()

/** The bust as a picture. An image is rasterised once and then just moved, where inline SVG with blur filters is repainted every time it moves. */
function useBustPicture(light: Light, color: string) {
  const key = `${light}|${color}`
  const host = useRef<HTMLDivElement>(null)
  const [, bump] = useState(0)
  useLayoutEffect(() => {
    if (pictures.has(key)) return
    const svg = host.current?.querySelector('svg')
    if (!svg) return
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    pictures.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)))
    bump(n => n + 1)
  }, [key])
  const url = pictures.get(key)
  // until the picture exists, the SVG is drawn once off-screen to make it
  return { url, source: url ? null : <div ref={host} className="bust-src" aria-hidden><Bust light={light} id="b" color={color} /></div> }
}

/** A lit bust as an image. When the colour changes, the new picture fades in over the old one. */
export function LitBust({ light, color = '#9d8cff', cover }: { light: Light; color?: string; cover?: boolean }) {
  const { url, source } = useBustPicture(light, color)
  const shown = useRef<string | undefined>(undefined)
  const [under, setUnder] = useState<string>()
  useEffect(() => { if (!url) return; if (shown.current && shown.current !== url) setUnder(shown.current); shown.current = url }, [url])
  return <div className={`lit-bust ${cover ? 'cover' : ''}`}>
    {source}
    {under && <img className="under" src={under} alt="" draggable={false} />}
    {url && <img key={url} className="over" src={url} alt="" draggable={false} decoding="async" onAnimationEnd={() => setUnder(undefined)} />}
  </div>
}
