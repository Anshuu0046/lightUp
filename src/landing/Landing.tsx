import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Download, Globe, Monitor, Smartphone } from 'lucide-react'
import { AccountButton } from '../cloud/Account'
import { HUES, type Hue } from '../live/rig'
import { HUE_NAMES } from '../live/Swatches'
import { LitBust } from './Bust'
import './landing.css'

const RELEASES = 'https://github.com/Anshuu0046/lightUp/releases/latest'

/**
 * The home page. It's built as a dark room: the pointer (or a finger, or a slow drift when nobody touches anything)
 * is the light. Pinned sections are driven by scroll progress, written to a --p custom property (0-1) per section,
 * so every animation is a plain CSS transform of --p.
 */
export default function Landing() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current!
    const scenes = [...el.querySelectorAll<HTMLElement>('[data-scene]')]
    const hero = el.querySelector<HTMLElement>('.hero')!, copy = el.querySelector<HTMLElement>('.hero-copy')!, title = el.querySelector<HTMLElement>('.hero h1')!
    const bar = el.querySelector<HTMLElement>('.progress i')!
    const coarse = matchMedia('(pointer: coarse)').matches
    // weaker devices start on the lighter page; a frame-rate watch below catches any others
    const mem = (navigator as { deviceMemory?: number }).deviceMemory
    if ((mem !== undefined && mem <= 4) || (navigator.hardwareConcurrency || 8) <= 4) el.classList.add('lite')
    el.focus({ preventScroll: true }) // so the keyboard scrolls the page
    let raf = 0, stopped = false, heroP = 0

    // where each pinned scene starts and how far it scrolls, measured once (not on every scroll)
    let geo: { s: HTMLElement; top: number; span: number; p: number }[] = []
    const titleBox = { x: 0, y: 0, cx: 0, cy: 0 }
    const measure = () => {
      const vh = el.clientHeight
      geo = scenes.map(s => ({ s, top: s.offsetTop, span: Math.max(1, s.offsetHeight - vh), p: -1 }))
      // the headline's place inside the hero, ignoring the scroll transform (offsets don't include transforms)
      titleBox.x = copy.offsetLeft + title.offsetLeft; titleBox.y = copy.offsetTop + title.offsetTop
      titleBox.cx = copy.offsetLeft + copy.offsetWidth / 2; titleBox.cy = copy.offsetTop + copy.offsetHeight / 2
      onScroll()
    }
    const onScroll = () => {
      raf = 0
      const top = el.scrollTop
      for (const g of geo) {
        const p = Math.min(1, Math.max(0, (top - g.top) / g.span))
        if (Math.abs(p - g.p) < 0.0004 && p !== 0 && p !== 1) continue // nothing visible changes
        if (p === g.p) continue
        g.p = p
        g.s.style.setProperty('--p', p.toFixed(4))
        if (g.s.dataset.scene === 'hero') heroP = p
        if (g.s.dataset.scene === 'lights') { const a = String(Math.round(p * 2)); if (g.s.dataset.active !== a) g.s.dataset.active = a }
      }
      const max = el.scrollHeight - el.clientHeight
      bar.style.transform = `scaleX(${max > 0 ? (top / max).toFixed(4) : 0})`
      el.classList.toggle('scrolled', top > 30)
    }
    const queue = () => { if (!raf) raf = requestAnimationFrame(onScroll) }
    el.addEventListener('scroll', queue, { passive: true })
    const ro = new ResizeObserver(measure); ro.observe(el)
    document.fonts?.ready.then(measure)
    measure()

    // the light follows the pointer with a little weight; left alone, it drifts across the headline by itself
    let tx = 0.5, ty = 0.42, x = 0.3, y = 0.4, moved = -1e9, lastFrame = 0
    const point = (e: PointerEvent) => { tx = e.clientX / innerWidth; ty = e.clientY / innerHeight; moved = performance.now() }
    addEventListener('pointermove', point, { passive: true })
    // frame-rate watch: if the hero can't hold 32 fps over two 2-second windows in a row (after the page has settled), switch to the lighter page for good
    let win = { start: 0, frames: 0 }, slowWindows = 0
    const light = (now: number) => {
      if (stopped) return
      requestAnimationFrame(light)
      if (document.hidden || el.scrollTop > el.clientHeight * 1.2) { win.start = 0; slowWindows = 0; return } // the hero is out of sight: nothing to do
      const lite = el.classList.contains('lite')
      if (!lite && now > 2500) {
        if (!win.start) win = { start: now, frames: 0 }
        else if (++win.frames && now - win.start >= 2000) {
          slowWindows = win.frames / ((now - win.start) / 1000) < 32 ? slowWindows + 1 : 0
          if (slowWindows >= 2) el.classList.add('lite')
          win = { start: now, frames: 0 }
        }
      }
      if (now - lastFrame < (lite || coarse ? 33 : 0)) return // phones and weaker devices: 30 fps is plenty for a slow drift
      lastFrame = now
      if (now - moved > 2600) { tx = 0.5 + 0.34 * Math.sin(now / 2600); ty = 0.4 + 0.1 * Math.sin(now / 1900) }
      x += (tx - x) * 0.075; y += (ty - y) * 0.075
      hero.style.setProperty('--mx', x.toFixed(4)); hero.style.setProperty('--my', y.toFixed(4))
      if (!lite) {
        // pointer position in the headline's own coordinates, undoing the scroll transform (move up 140px, shrink to 88%)
        const s = 1 - heroP * 0.12, dy = heroP * -140
        const ux = (x * innerWidth - titleBox.cx) / s + titleBox.cx - titleBox.x, uy = (y * innerHeight - dy - titleBox.cy) / s + titleBox.cy - titleBox.y
        title.style.setProperty('--lx', `${ux.toFixed(1)}px`); title.style.setProperty('--ly', `${uy.toFixed(1)}px`)
      }
    }
    requestAnimationFrame(light)

    // everything else rises into view once; and animations only run while their section is on screen
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { root: el, threshold: 0.18 })
    el.querySelectorAll('.rv').forEach(n => io.observe(n))
    const seen = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('on-screen', e.isIntersecting)), { root: el, rootMargin: '80px' })
    el.querySelectorAll('section').forEach(n => seen.observe(n))

    // pointer extras (mouse only): buttons lean toward the cursor, cards catch a spotlight
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
    const over = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      const mag = t.closest<HTMLElement>('.mag')
      if (mag) { const r = mag.getBoundingClientRect(); mag.style.setProperty('--tx', `${((e.clientX - r.left) / r.width - 0.5) * 12}px`); mag.style.setProperty('--ty', `${((e.clientY - r.top) / r.height - 0.5) * 10}px`) }
      const card = t.closest<HTMLElement>('.platform')
      if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--sx', `${e.clientX - r.left}px`); card.style.setProperty('--sy', `${e.clientY - r.top}px`) }
    }
    const out = (e: PointerEvent) => { const mag = (e.target as HTMLElement).closest<HTMLElement>('.mag'); if (mag) { mag.style.removeProperty('--tx'); mag.style.removeProperty('--ty') } }
    if (fine) { el.addEventListener('pointermove', over, { passive: true }); el.addEventListener('pointerout', out) }
    return () => { stopped = true; el.removeEventListener('scroll', queue); el.removeEventListener('pointermove', over); el.removeEventListener('pointerout', out); removeEventListener('pointermove', point); ro.disconnect(); io.disconnect(); seen.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  /** Scrolls the pinned lights scene so that light i is the one in front */
  const lookAt = (i: number) => {
    const el = root.current!, s = el.querySelector<HTMLElement>('.lights')!
    el.scrollTo({ top: s.offsetTop + (i / 2) * (s.offsetHeight - el.clientHeight), behavior: 'smooth' })
  }

  const jump = (id: string) => root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' })

  return <div className="landing" ref={root} tabIndex={-1}>
    <div className="grain" aria-hidden />
    <div className="progress" aria-hidden><i /></div>
    <nav className="lnav">
      <a className="lbrand" href="#"><span className="lbrand-ring" /> Light Up</a>
      <div className="lnav-links">
        <button onClick={() => jump('lights')}>Lights</button>
        <button onClick={() => jump('editor')}>Editor</button>
        <button onClick={() => jump('get')}>Download</button>
      </div>
      <div className="lnav-end"><AccountButton /><a className="lbtn small" href="#/live">Open studio</a></div>
    </nav>

    {/* ---------- 1. a dark room, lit by you ---------- */}
    <section className="hero" data-scene="hero">
      <div className="hero-stage">
        <div className="hero-room" aria-hidden />
        <div className="ring3d" aria-hidden>
          <div className="ring-tilt">
            <span className="ring-housing" /><span className="ring-tube" /><span className="ring-diffuser" /><span className="ring-stand" />
          </div>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Creator studio · free · on your device</p>
          <h1><span className="dim">Look like you own a <em>studio.</em></span><span className="lit" aria-hidden>Look like you own a <em>studio.</em></span></h1>
          <p className="hero-sub">A ring light, a window and a bulb you hold in your hand, drawn into your camera live from a depth map of your face. Then cut it, add keyframes, filters and effects, and export it for Reels, Shorts and TikTok.</p>
          <div className="hero-cta">
            <a className="lbtn mag" href="#/live">Turn on the light <ArrowRight size={16} /></a>
            <a className="lbtn ghost mag" href="#/edit">Edit a video</a>
          </div>
        </div>
        <div className="flood" aria-hidden><p>Click. <em>You’re lit.</em></p></div>
        <div className="scroll-cue" aria-hidden><span /></div>
      </div>
    </section>

    {/* ---------- 2. three lights, on a turning stage ---------- */}
    <section className="lights" id="lights" data-scene="lights" data-active="0">
      <div className="lights-stage">
        <header className="lights-head">
          <p className="eyebrow">01 · Live lighting</p>
          <h2>Three lights. <em>No gear.</em></h2>
        </header>
        <div className="wheel-wrap">
          <div className="wheel">
            {LIGHTS.map((l, i) => <figure key={l.id} className="lcard" data-i={i} style={{ '--i': i } as React.CSSProperties}>
              <LitBust light={l.id} />
              {l.id === 'bulb' && <i className="bulb-pulse" aria-hidden />}
              <figcaption>{l.name}</figcaption>
            </figure>)}
          </div>
        </div>
        <div className="lights-text">
          {LIGHTS.map((l, i) => <div key={l.id} className="ltext" data-i={i}><b>{l.name}</b><p>{l.text}</p></div>)}
          <div className="ldots" role="tablist" aria-label="Choose a light">{LIGHTS.map((l, i) => <button key={l.id} role="tab" data-i={i} aria-label={l.name} onClick={() => lookAt(i)} />)}</div>
        </div>
      </div>
    </section>

    {/* ---------- 3. the wall behind you ---------- */}
    <RgbWall />

    {/* ---------- 4. the editor, rising out of the page ---------- */}
    <section className="editor-scene" id="editor" data-scene="editor">
      <div className="editor-stage">
        <header className="rv">
          <p className="eyebrow">03 · Editor</p>
          <h2>Then cut it into something <em>people finish.</em></h2>
        </header>
        <div className="mock-wrap">
          <EditorMock />
          {CHIPS.map((c, i) => <span key={c} className="chip" style={{ '--d': CHIP_DEPTH[i], ...CHIP_POS[i] } as React.CSSProperties}>{c}</span>)}
        </div>
      </div>
    </section>

    <div className="ribbon" aria-hidden>
      <div>{[0, 1].map(k => <span key={k}>{RIBBON.map(w => <b key={w + k}>{w}<i /></b>)}</span>)}</div>
    </div>

    {/* ---------- 6. everywhere ---------- */}
    <section className="get" id="get">
      <div className="rv">
        <p className="eyebrow">04 · Everywhere</p>
        <h2>Your light, <em>in every app.</em></h2>
      </div>
      <div className="platforms">
        <a className="platform rv" href="#/live" style={{ '--d': 0 } as React.CSSProperties}>
          <Globe size={22} /><b>In your browser</b><p>Open it and go live. Nothing to install, and your camera never leaves the page.</p><span>Open studio <ArrowRight size={14} /></span>
        </a>
        <a className="platform rv" href={RELEASES} target="_blank" rel="noreferrer" style={{ '--d': 1 } as React.CSSProperties}>
          <Monitor size={22} /><b>Windows</b><p>Adds “Light Up Camera”, so your light shows up in Zoom, Teams, OBS and TikTok Live Studio.</p><span>Download for Windows <Download size={14} /></span>
        </a>
        <a className="platform rv" href={RELEASES} target="_blank" rel="noreferrer" style={{ '--d': 2 } as React.CSSProperties}>
          <Smartphone size={22} /><b>Android</b><p>The whole studio in your pocket: lighting and editor, offline.</p><span>Download the app <Download size={14} /></span>
        </a>
      </div>
    </section>

    <section className="privacy">
      <p className="rv big">Your face never leaves <em>your device.</em></p>
      <p className="rv lead" style={{ '--d': 1 } as React.CSSProperties}>Lighting and exports run on your own hardware. No uploads. No account needed.</p>
    </section>

    <section className="finale">
      <div className="finale-glow" aria-hidden />
      <h2 className="rv">The light’s <em>on you.</em></h2>
      <a className="switch-btn mag rv" href="#/live" style={{ '--d': 1 } as React.CSSProperties}><span className="switch-ring" />Turn on the light</a>
    </section>

    <footer className="lfoot">
      <span><span className="lbrand-ring" /> Light Up</span>
      <span>Made for creators · {new Date().getFullYear()}</span>
      <span><a href="#/live">Studio</a><a href="#/edit">Editor</a><a href="https://github.com/Anshuu0046/lightUp" target="_blank" rel="noreferrer">GitHub</a></span>
    </footer>
  </div>
}

const LIGHTS: { id: 'ring' | 'window' | 'bulb'; name: string; text: string }[] = [
  { id: 'ring', name: 'Ring light', text: 'Soft, even and flattering, with the ring reflected in your eyes, like every beauty video you’ve watched.' },
  { id: 'window', name: 'Window', text: 'Daylight from one side. Half your face falls into soft shadow, the look cinematographers wait all day for.' },
  { id: 'bulb', name: 'Bulb in your hand', text: 'Hold up your hand and a warm bulb appears in it. It follows your palm, glows through your fingers and casts real shadows.' },
]

const RIBBON = ['Reels', 'Shorts', 'TikTok', 'Live streams', 'Zoom', 'Teams', 'OBS', 'Podcasts', 'Vlogs', 'Keyframes', 'LUTs', 'Teleprompter']
const CHIPS = ['Teleprompter', 'Music ducks under your voice', 'Remove the background', 'Relight any clip', '12 looks', 'GIFs & stickers', '1080p MP4']
const CHIP_DEPTH = [1.4, 0.7, 1.1, 1.6, 0.6, 1.2, 0.9]
const CHIP_POS: React.CSSProperties[] = [{ left: '-4%', top: '8%' }, { right: '-3%', top: '14%' }, { left: '-6%', top: '46%' }, { right: '-5%', top: '50%' }, { left: '6%', bottom: '-4%' }, { right: '10%', bottom: '-6%' }, { left: '30%', bottom: '-8%' }]

/** Pick a colour and the lamp behind the bust changes, the way it does live */
function RgbWall() {
  const [hue, setHue] = useState<Hue>('purple')
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    if (!auto) return
    const order = Object.keys(HUES) as Hue[]
    const t = setInterval(() => setHue(h => order[(order.indexOf(h) + 1) % order.length]), 1800)
    return () => clearInterval(t)
  }, [auto])
  const rgb = (h: Hue) => { const [r, g, b] = HUES[h as keyof typeof HUES] ?? [1, 1, 1]; return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})` }
  return <section className="rgb-scene" style={{ '--hue': rgb(hue) } as React.CSSProperties}>
    <div className="rgb-art rv"><LitBust light="rgb" color={rgb(hue)} /></div>
    <div className="rgb-copy rv" style={{ '--d': 1 } as React.CSSProperties}>
      <p className="eyebrow">02 · Background light</p>
      <h2>Paint the wall <em>behind you.</em></h2>
      <p className="lead">Pick a colour and an RGB lamp lights the wall at your back and catches the edge of your hair, while your face keeps its own light.</p>
      <div className="rgb-dots" role="radiogroup" aria-label="Lamp colour">
        {(Object.keys(HUES) as Hue[]).map(h => <button key={h} role="radio" aria-checked={hue === h} aria-label={HUE_NAMES[h]} className={hue === h ? 'on' : ''} style={{ background: rgb(h) }} onClick={() => { setAuto(false); setHue(h) }} />)}
      </div>
      <div className="signs">
        <p className="eyebrow">Hands-free</p>
        <ul>{[['✌️', 'Photo'], ['👍', 'Record'], ['☝️', 'Next light'], ['👌', 'Brightness']].map(([g, t]) => <li key={t}><span>{g}</span>{t}</li>)}</ul>
      </div>
    </div>
  </section>
}

/** The editor, drawn in HTML so it stays sharp; the playhead runs with the scroll */
function EditorMock() {
  return <div className="mock" aria-hidden>
    <div className="mock-top"><i /><i /><i /><span>Morning routine.mp4</span><b>Export</b></div>
    <div className="mock-body">
      <div className="mock-side">{['#5b4b7a', '#7a4b4b', '#3f5e55', '#6b5a3a'].map(c => <span key={c} style={{ background: c }} />)}</div>
      <div className="mock-preview"><div className="mock-frame"><LitBust light="rgb" color="#ff5aa8" /><span className="mock-cap">this changed <b>everything</b></span></div></div>
      <div className="mock-side right">{[70, 45, 85, 30, 60].map((w, i) => <span key={i} style={{ width: `${w}%` }} />)}</div>
    </div>
    <div className="mock-tl">
      <div className="trk"><span className="clp text" style={{ left: '8%', width: '20%' }} /><span className="clp text" style={{ left: '34%', width: '26%' }} /><span className="clp text" style={{ left: '66%', width: '18%' }} /></div>
      <div className="trk"><span className="clp sticker" style={{ left: '40%', width: '12%' }} /></div>
      <div className="trk tall"><span className="clp video" style={{ left: '0%', width: '38%' }} /><span className="clp video b" style={{ left: '38.5%', width: '33%' }} /><span className="clp video c" style={{ left: '72%', width: '28%' }} /></div>
      <div className="trk"><span className="clp music" style={{ left: '0%', width: '100%' }} /></div>
      <div className="playhead" />
    </div>
  </div>
}

