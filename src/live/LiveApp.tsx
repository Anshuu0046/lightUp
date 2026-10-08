import { useEffect, useRef, useState } from 'react'
import { Camera, Circle, House, Maximize2, Square, Video, X } from 'lucide-react'
import { createFaceTracker, createHandTracker, type Face, type Gesture, type Hand } from '../faceTracker'
import { startRecording, takePhoto } from '../recorder'
import { bridge, startVirtualCamera } from '../virtualCamera'
import { AutoLight, NEUTRAL } from './autoLight'
import { track } from '../cloud/supabase'
import { DEFAULT_LOOK, drawCatchlights, glide, rigFor, WARMTH_MAX, WARMTH_MIN, type Look, type Rig, type Spot, type Style } from './rig'
import { HUE_NAMES, Swatches } from './Swatches'
import { Teleprompter, useScript } from '../Teleprompter'
import './live.css'

const STYLES: { id: Style; name: string; hint: string }[] = [
  { id: 'bulb', name: 'Bulb', hint: 'Hold the light in your hand' },
  { id: 'ring', name: 'Ring light', hint: 'Soft, even, flattering' },
  { id: 'window', name: 'Window', hint: 'Daylight from the side' },
  { id: 'natural', name: 'Natural', hint: 'Your camera as is' },
]

function loadLook(): Look {
  try { return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem('lightup-look') || '{}') } } catch { return DEFAULT_LOOK }
}

/** Opens a real camera, never our own virtual one (that would feed the picture back into itself) */
async function openCamera(deviceId?: string): Promise<MediaStream> {
  // dev only: #/live?video=/clip.mp4 stands in for a webcam so lighting can be tuned without one
  const clip = import.meta.env.DEV && new URLSearchParams(location.hash.split('?')[1] ?? '').get('video')
  if (clip === 'blank') { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d')!; g.fillStyle = '#3a3542'; g.fillRect(0, 0, 1280, 720); return c.captureStream(1) }
  if (clip) {
    const v = document.createElement('video'); v.src = clip; v.muted = true; v.loop = true; await v.play(); Object.assign(window, { __clip: v })
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d')!
    setInterval(() => { g.filter = `brightness(${(window as unknown as { __bright?: number }).__bright ?? 1})`; const s = Math.max(1280 / v.videoWidth, 720 / v.videoHeight); g.drawImage(v, (1280 - v.videoWidth * s) / 2, (720 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s) }, 33)
    return c.captureStream(30)
  }
  const phone = matchMedia('(pointer: coarse)').matches
  // phones: the front camera, in portrait, at a size the phone can light in real time
  const video = phone ? { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
  let stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { ...video, deviceId: { exact: deviceId } } : video, audio: false })
  if (!deviceId && /light up/i.test(stream.getVideoTracks()[0]?.label ?? '')) {
    const real = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'videoinput' && !/light up/i.test(d.label))
    if (real) { stream.getTracks().forEach(t => t.stop()); stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: { exact: real.deviceId } }, audio: false }) }
  }
  return stream
}

export default function LiveApp() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async (deviceId?: string) => {
    setBusy(true); setError('')
    try { setStream(await openCamera(deviceId)); if (!deviceId) track('live_start') }
    catch { setError('Camera access was blocked or no camera was found. Allow camera access and try again.') }
    finally { setBusy(false) }
  }
  // the app owns the camera: release the old one whenever it changes or the app closes
  useEffect(() => () => stream?.getTracks().forEach(t => t.stop()), [stream])
  if (!stream) return <Welcome onStart={() => start()} busy={busy} error={error} />
  return <Live stream={stream} onSwitchCamera={start} />
}

function Welcome({ onStart, busy, error }: { onStart: () => void; busy: boolean; error: string }) {
  return <main className="welcome">
    <div className="welcome-glow" aria-hidden />
    <div className="halo" aria-hidden><span /></div>
    <h1>Light that looks <em>real</em>.</h1>
    <p>Hold a glowing bulb in your hand, or switch on a studio ring light or soft window light. Rendered live, on your own computer.</p>
    <button className="start" onClick={onStart} disabled={busy}>{busy ? 'Opening camera…' : 'Turn on camera'}</button>
    {error ? <small className="error">{error}</small> : <small>Your video never leaves this device.</small>}
  </main>
}

type Status = 'loading' | 'ready' | 'plain'
let gpuQueue: Promise<unknown> = Promise.resolve()

function Live({ stream, onSwitchCamera }: { stream: MediaStream; onSwitchCamera: (id: string) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [look, setLook] = useState<Look>(loadLook)
  const lookRef = useRef(look); lookRef.current = look
  const [status, setStatus] = useState<Status>('loading')
  const [open, setOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [toast, setToast] = useState('')
  const [live, setLive] = useState<(() => void) | null>(null)
  const [rec, setRec] = useState<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const [secs, setSecs] = useState(0)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [handHint, setHandHint] = useState(false)
  const [counter, setCounter] = useState(0)
  const { script, setScript, tele, setTele } = useScript()
  const count = useRef(0)
  const onGesture = useRef<(g: Gesture | null, hand: Hand, now: number) => void>(() => {})
  // where the bulb is when no hand is holding it; a click or drag moves it
  const spot = useRef<Spot>({ x: 0.3, y: 0.45, z: 0.42 })
  const placed = useRef(false)
  const cleanup = useRef({ live, rec }); cleanup.current = { live, rec }

  useEffect(() => { try { localStorage.setItem('lightup-look', JSON.stringify(look)) } catch { /* private mode */ } }, [look])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (!rec) return; setSecs(0); const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t) }, [rec])
  useEffect(() => () => { cleanup.current.live?.(); cleanup.current.rec?.stop() }, [])
  useEffect(() => { navigator.mediaDevices.enumerateDevices().then(d => setCameras(d.filter(x => x.kind === 'videoinput' && !/light up/i.test(x.label)))).catch(() => {}) }, [stream])

  // keyboard: S settings, 1-4 light style, F fullscreen, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return
      const k = e.key.toLowerCase()
      if (k === 's') setOpen(o => !o)
      else if (k === 'escape') setOpen(false)
      else if (k === 'f') toggleFullscreen()
      else if (k >= '1' && k <= '4') setLook(l => ({ ...l, style: STYLES[+k - 1].id }))
    }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [])

  // hide the button and cursor when nobody is touching anything
  useEffect(() => {
    let t = 0
    const wake = () => { setIdle(false); clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2600) }
    // a tap on a touch screen never moves the pointer, so presses wake it too (otherwise the settings button could vanish for good on a phone)
    wake(); for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, wake)
    return () => { clearTimeout(t); for (const ev of ['pointermove', 'pointerdown', 'keydown']) removeEventListener(ev, wake) }
  }, [])

  // camera -> face tracking -> relight -> catchlights, once per camera frame
  useEffect(() => {
    const v = video.current!, c = canvas.current!, o = overlay.current!
    v.srcObject = stream; v.play().catch(() => {})
    let stopped = false, runtime: { draw: (v: HTMLVideoElement, s: Record<string, unknown>, skipDepth?: boolean) => void; destroy: () => void; gpuMs: number } | undefined
    let tracker: Awaited<ReturnType<typeof createFaceTracker>> | undefined, face: Face | undefined, frame = 0
    let hands: Awaited<ReturnType<typeof createHandTracker>> | undefined, loadingHands = false, lastHand = 0, hinted = false
    // phones: run the depth model on every Nth frame (N adapts to the GPU) and alternate face and hand tracking
    const phone = matchMedia('(pointer: coarse)').matches
    let frameNo = 0, depthEvery = phone ? 2 : 1
    const rig: Rig = rigFor(lookRef.current, undefined, spot.current)
    const auto = new AutoLight()
    let corr = NEUTRAL
    if (import.meta.env.DEV) Object.assign(window, { __auto: auto })
    createFaceTracker().then(t => { tracker = t }).catch(() => {})
    if (navigator.gpu) {
      // one engine at a time per canvas: a late start-up must not tear down the engine that replaced it
      gpuQueue = gpuQueue.then(async () => {
        if (stopped) return
        const { DepthRuntime } = await import('../depthRuntime')
        const r = new DepthRuntime()
        try { await r.init(c); if (stopped) { r.destroy(); return } runtime = r; setStatus('ready') }
        catch { r.destroy(); if (!stopped) setStatus('plain') }
      })
    } else setStatus('plain')

    const tick = (now: number) => {
      if (stopped) return
      if (v.readyState >= 2 && v.videoWidth) {
        frameNo++
        const bulbMode = lookRef.current.style === 'bulb'
        const faceTurn = !phone || !bulbMode || frameNo % 2 === 1
        const found = faceTurn ? tracker?.detect(v, now) : face
        if (faceTurn) face = found ?? face
        const gestures = lookRef.current.gestures
        const handTurn = bulbMode ? !phone || frameNo % 2 === 0 || !face : gestures && frameNo % (phone ? 4 : 3) === 0
        if (handTurn) {
          if (!hands && !loadingHands) { loadingHands = true; createHandTracker().then(h => { hands = h }).catch(() => {}) }
          const hand = hands?.detect(v, now)
          if (bulbMode) {
            // a bigger hand is closer to the camera, so the bulb comes forward with it, always just in front of the palm
            if (hand) { spot.current = { x: hand.x, y: hand.y, z: 0.18 + Math.min(0.3, Math.max(0, (hand.size - 0.08) * 1.5)) }; lastHand = now; placed.current = true }
            const wantHint = !placed.current && now - lastHand > 2500
            if (wantHint !== hinted) { hinted = wantHint; setHandHint(wantHint) }
          }
          if (gestures && hand && hand.gesture !== undefined) onGesture.current(hand.gesture, hand, now)
        }
        if (!bulbMode && hinted) { hinted = false; setHandHint(false) }
        glide(rig, rigFor(lookRef.current, face, spot.current), bulbMode ? 0.6 : 0.14) // the hand filter already smooths the bulb
        if (runtime && frameNo % 30 === 0) {
          const gpu = runtime.gpuMs
          if (gpu > 30 && depthEvery < 4) depthEvery++
          else if (gpu && gpu < 14 && depthEvery > 1) depthEvery--
        }
        // a real filament never burns perfectly still: a 2-3% shimmer
        const shimmer = bulbMode ? 1 + 0.018 * Math.sin(now * 0.0131) + 0.012 * Math.sin(now * 0.0377 + 1.3) : 1
        // auto light may pull a tinted white back toward white, but a chosen RGB colour stays as picked
        const whiten = lookRef.current.keyHue === 'white' ? corr.whiten : 0
        runtime?.draw(v, { lightPosition: [rig.x, rig.y], lightZ: rig.z, falloff: rig.falloff, lightColor: [rig.r + (1 - rig.r) * whiten, rig.g + (1 - rig.g) * whiten, rig.b + (1 - rig.b) * whiten], backColor: [rig.br, rig.bg, rig.bb, rig.back], backPosition: [rig.bx, rig.by], intensity: rig.intensity * corr.gain * shimmer, exposure: rig.exposure * (lookRef.current.style === 'bulb' ? 1 : Math.min(2.2, Math.max(0.4, Math.sqrt(corr.gain)))), relief: rig.relief, specular: rig.specular, shadow: rig.shadow, occlusion: rig.occlusion, bulb: rig.bulb, skinSoften: rig.smooth, mirror: false }, frameNo % depthEvery !== 0)
        corr = runtime ? auto.update(c, v, found ? face : undefined, lookRef.current.style, lookRef.current.brightness, lookRef.current.auto) : NEUTRAL
        const W = Math.min(1280, v.videoWidth), H = Math.round(W * v.videoHeight / v.videoWidth)
        if (o.width !== W || o.height !== H) { o.width = W; o.height = H }
        drawCatchlights(o.getContext('2d')!, W, H, found ? face : undefined, lookRef.current.style, runtime ? rig.catch : 0, [rig.r, rig.g, rig.b], rig)
      }
      frame = 'requestVideoFrameCallback' in v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
    }
    tick(performance.now())
    return () => {
      stopped = true
      if ('cancelVideoFrameCallback' in v) v.cancelVideoFrameCallback(frame); cancelAnimationFrame(frame)
      runtime?.destroy()
    }
  }, [stream])

  const run = async (f: () => unknown) => { try { await f() } catch (e) { setToast(e instanceof Error ? e.message : 'Something went wrong.') } }
  const set = (p: Partial<Look>) => setLook(l => ({ ...l, ...p }))
  const toggleLive = () => run(async () => {
    if (live) { live(); setLive(null); setToast('Stopped sending to Light Up Camera'); return }
    const stop = await startVirtualCamera(stage.current!)
    setLive(() => stop); setToast('Live: choose “Light Up Camera” in Zoom, Teams or OBS'); track('vcam_start')
  })
  const toggleRec = () => run(async () => {
    if (rec) { const r = rec; setRec(null); setToast(`Video saved to ${await r.stop()}`); return }
    setRec(await startRecording(stage.current!))
    setOpen(false) // out of the way, so the whole picture and the script are in view
  })
  // click or drag on the picture to put the bulb there (the preview is mirrored and cropped to fill the screen)
  const placeBulb = (e: React.PointerEvent) => {
    if (lookRef.current.style !== 'bulb' || !(e.buttons & 1) || !video.current?.videoWidth) return
    const box = e.currentTarget.getBoundingClientRect(), v = video.current
    const u = 1 - (e.clientX - box.left) / box.width, w = (e.clientY - box.top) / box.height
    const frameAspect = v.videoWidth / v.videoHeight, boxAspect = box.width / box.height
    const x = frameAspect > boxAspect ? 0.5 + (u - 0.5) * boxAspect / frameAspect : u
    const y = frameAspect > boxAspect ? w : 0.5 + (w - 0.5) * frameAspect / boxAspect
    spot.current = { x, y, z: 0.42 }; placed.current = true; setHandHint(false)
  }
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const nextStyle = (step: number) => { const i = (STYLES.findIndex(s => s.id === look.style) + step + STYLES.length) % STYLES.length; set({ style: STYLES[i].id }); setToast(STYLES[i].name) }
  const setBrightness = (b: number) => { b = Math.round(Math.min(100, Math.max(0, b))); if (b !== look.brightness) { set({ brightness: b }); setToast(`Brightness ${b}`) } }
  // a short countdown, so a hand sign never ends up in the photo
  const countdownThen = (what: string, f: () => void) => {
    if (count.current) return
    let n = 3; count.current = n; setCounter(n); setToast(what)
    const t = setInterval(() => { n--; count.current = n; setCounter(n); if (!n) { clearInterval(t); f() } }, 1000)
  }
  const photo = () => run(async () => { setToast(`Photo saved to ${await takePhoto(stage.current!)}`) })

  // hand signs: ✌️ photo, 👍 start/stop recording, ☝️ next light, 👌 then move up or down for brightness
  const signs = useRef({ sign: null as Gesture | null, since: 0, ready: 0, pinch: null as { y: number; b: number } | null })
  onGesture.current = (g, hand, now) => {
    const s = signs.current
    if (g !== s.sign) { s.sign = g; s.since = now; s.pinch = null }
    if (g === 'pinch') {
      if (now - s.since < 250) return
      if (!s.pinch) s.pinch = { y: hand.y, b: look.brightness }
      else setBrightness(s.pinch.b + (s.pinch.y - hand.y) * 220)
      return
    }
    if (!g || now - s.since < 450 || now < s.ready) return
    s.ready = now + 2500
    if (g === 'victory') countdownThen('✌️ Photo in 3…', photo)
    else if (g === 'thumbsUp') { if (rec) toggleRec(); else countdownThen('👍 Recording in 3…', toggleRec) }
    else if (g === 'point') nextStyle(1)
  }

  // touch or drag on the picture (except in bulb mode, where that places the bulb): swipe sideways to change the light, up or down for brightness
  const swipe = useRef<{ x: number; y: number; b: number; moved: boolean } | null>(null)
  const stageDown = (e: React.PointerEvent) => { if (look.style === 'bulb') return placeBulb(e); swipe.current = { x: e.clientX, y: e.clientY, b: look.brightness, moved: false } }
  const stageMove = (e: React.PointerEvent) => {
    if (look.style === 'bulb') return placeBulb(e)
    const s = swipe.current, dx = s ? e.clientX - s.x : 0, dy = s ? e.clientY - s.y : 0
    if (s && Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) { s.moved = true; setBrightness(s.b - dy / 3) }
  }
  const stageUp = (e: React.PointerEvent) => {
    const s = swipe.current; swipe.current = null
    if (!s || s.moved) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) nextStyle(dx < 0 ? 1 : -1)
  }

  return <div className={`live ${idle && !open ? 'idle' : ''} ${tele.on ? 'has-tele' : ''}`}>
    <div className={`live-stage ${look.style === 'bulb' ? 'placeable' : ''}`} ref={stage} onPointerDown={stageDown} onPointerMove={stageMove} onPointerUp={stageUp} onPointerCancel={() => { swipe.current = null }}>
      <video ref={video} className={status === 'plain' ? 'plain' : ''} muted playsInline />
      <canvas ref={canvas} className={`gpu-canvas depth-canvas ${status === 'ready' ? 'active' : ''}`} />
      <canvas ref={overlay} className="ring-overlay" />
    </div>

    {status === 'loading' && <div className="pill center"><span className="spinner" /> Preparing realistic lighting…</div>}
    {status === 'plain' && <div className="pill top">Lighting isn’t available on this device, so you’re seeing your camera as is.</div>}
    {toast && <div className="pill top" role="status">{toast}</div>}
    {counter > 0 && <div className="countdown" aria-live="assertive">{counter}</div>}
    {tele.on && <Teleprompter className="live-tele" script={script} running={!!rec} speed={tele.speed} size={tele.size} />}
    {handHint && !toast && status === 'ready' && <div className="pill bottom">Hold up your hand to carry the bulb, or click anywhere to place it</div>}
    {(rec || live) && <div className="badges">{rec && <span className="badge rec"><i /> REC {time}</span>}{live && <span className="badge on"><i /> Light Up Camera</span>}</div>}

    <button className={`fab ${open ? 'hidden' : ''}`} onClick={() => setOpen(true)} aria-label="Lighting settings (S)" title="Lighting settings (S)"><span className="fab-ring" /></button>

    <aside className={`panel ${open ? 'open' : ''}`} aria-hidden={!open}>
      <header>
        <div className="brand"><span className="brand-ring" /> Light Up</div>
        <span className="header-actions"><a className="icon" href="#" aria-label="Home" title="Home"><House size={15} /></a><button className="icon" onClick={() => setOpen(false)} aria-label="Close settings"><X size={16} /></button></span>
      </header>

      <div className="styles" role="radiogroup" aria-label="Light">
        {STYLES.map((s, i) => <button key={s.id} role="radio" aria-checked={look.style === s.id} className={`style ${look.style === s.id ? 'on' : ''}`} onClick={() => set({ style: s.id })}>
          <span className={`swatch ${s.id}`} />
          <b>{s.name}</b><small>{s.hint}</small><kbd>{i + 1}</kbd>
        </button>)}
      </div>

      <fieldset disabled={look.style === 'natural'}>
        <label className="slider"><span>Brightness <b>{look.brightness}</b></span>
          <input type="range" min="0" max="100" value={look.brightness} onChange={e => set({ brightness: +e.target.value })} style={{ '--p': `${look.brightness}%` } as React.CSSProperties} /></label>
        <div className="slider"><span>Light colour <b>{look.keyHue === 'white' ? 'White' : HUE_NAMES[look.keyHue]}</b></span>
          <Swatches value={look.keyHue} none={{ id: 'white', name: 'White (choose warmth below)' }} onPick={keyHue => set({ keyHue })} /></div>
        {look.keyHue === 'white' && <label className="slider warmth"><span>Warmth <b>{look.warmth > 7000 ? 'Blue' : `${look.warmth}K`}</b></span>
          <input type="range" min={WARMTH_MIN} max={WARMTH_MAX} step="100" value={WARMTH_MIN + WARMTH_MAX - look.warmth} onChange={e => set({ warmth: WARMTH_MIN + WARMTH_MAX - +e.target.value })} />
          <span className="ends"><small>Blue</small><small>Daylight</small><small>Warm</small></span></label>}
        <div className="slider"><span>Background light <b>{look.back === 'off' ? 'Off' : HUE_NAMES[look.back]}</b></span>
          <Swatches value={look.back} none={{ id: 'off', name: 'Off' }} onPick={back => set({ back })} /></div>
        {look.back !== 'off' && <>
          <label className="slider"><span>Background brightness <b>{look.backLevel}</b></span>
            <input type="range" min="0" max="100" value={look.backLevel} onChange={e => set({ backLevel: +e.target.value })} style={{ '--p': `${look.backLevel}%` } as React.CSSProperties} /></label>
          <label className="slider"><span>Lamp position</span>
            <input type="range" min="0" max="100" value={look.backSide} onChange={e => set({ backSide: +e.target.value })} style={{ '--p': `${look.backSide}%` } as React.CSSProperties} />
            <span className="ends"><small>Left</small><small>Behind you</small><small>Right</small></span></label>
        </>}
        <label className="switch"><span>Auto light<small>Keeps your face evenly lit in any room</small></span>
          <input type="checkbox" checked={look.auto} onChange={e => set({ auto: e.target.checked })} /><i /></label>
        <label className="switch"><span>Soft skin<small>The smooth, even skin a real ring light gives</small></span>
          <input type="checkbox" checked={look.softSkin} onChange={e => set({ softSkin: e.target.checked })} /><i /></label>
        <label className="switch"><span>Hand gestures<small>✌️ photo · 👍 record · ☝️ next light · 👌 move up/down for brightness</small></span>
          <input type="checkbox" checked={look.gestures} onChange={e => set({ gestures: e.target.checked })} /><i /></label>
        <label className="switch"><span>Eye catchlights<small>The light’s reflection in your eyes</small></span>
          <input type="checkbox" checked={look.catchlight} onChange={e => set({ catchlight: e.target.checked })} /><i /></label>
      </fieldset>

      <div className="tele-box">
        <label className="switch first"><span>Teleprompter<small>Your script scrolls on its own when you press Record. It isn’t in the video.</small></span>
          <input type="checkbox" checked={tele.on} onChange={e => setTele({ on: e.target.checked })} /><i /></label>
        {tele.on && <>
          <textarea className="tele-script" value={script} placeholder="Type or paste your script here…" rows={4} onChange={e => setScript(e.target.value)} />
          <label className="slider"><span>Scroll speed <b>{tele.speed}</b></span>
            <input type="range" min="1" max="10" value={tele.speed} onChange={e => setTele({ speed: +e.target.value })} style={{ '--p': `${(tele.speed - 1) * 11.1}%` } as React.CSSProperties} /></label>
          <label className="slider"><span>Text size <b>{tele.size}</b></span>
            <input type="range" min="18" max="56" value={tele.size} onChange={e => setTele({ size: +e.target.value })} style={{ '--p': `${((tele.size - 18) / 38) * 100}%` } as React.CSSProperties} /></label>
        </>}
      </div>

      <div className="actions">
        {bridge() && <button className={`action wide ${live ? 'on' : ''}`} onClick={toggleLive}><Video size={15} /> {live ? 'Live as Light Up Camera' : 'Use in Zoom, Teams & OBS'}</button>}
        <button className="action" onClick={() => run(async () => { setToast(`Photo saved to ${await takePhoto(stage.current!)}`) })}><Camera size={15} /> Photo</button>
        <button className={`action ${rec ? 'rec' : ''}`} onClick={toggleRec}>{rec ? <><Square size={13} /> Stop {time}</> : <><Circle size={13} /> Record</>}</button>
      </div>

      <footer>
        {cameras.length > 1 && <select aria-label="Camera" value={stream.getVideoTracks()[0]?.getSettings().deviceId} onChange={e => onSwitchCamera(e.target.value)}>
          {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>)}
        </select>}
        <button className="icon" onClick={toggleFullscreen} aria-label="Full screen (F)" title="Full screen (F)"><Maximize2 size={14} /></button>
        <small><kbd>S</kbd> settings · <kbd>F</kbd> full screen</small>
      </footer>
    </aside>
  </div>
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen().catch(() => {})
}
