import type { FaceLandmarker, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

// everything ships inside the app, so it works offline and never contacts a third party
const MODEL_URL = '/models/face_landmarker.task'
const WASM_PATH = '/mediapipe/wasm'

/** One eye: iris centre and radius, plus how open the lids are (0 closed, ~0.3 open). All in video-width fractions. */
export type Eye = { x: number; y: number; r: number; open: number }
/** Face in video fractions (0-1): centre, width, and both eyes */
export type Face = { x: number; y: number; w: number; eyes: [Eye, Eye] }

let landmarker: Promise<FaceLandmarker> | undefined
function load() {
  return landmarker ??= import('@mediapipe/tasks-vision').then(async ({ FaceLandmarker, FilesetResolver }) => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numFaces: 1 })
    return make('GPU').catch(() => make('CPU'))
  }).catch(e => { landmarker = undefined; throw e })
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Smoothing that is heavy while still and light while moving, so nothing jitters or lags */
const follow = (prev: number, next: number, gain = 14) => lerp(prev, next, Math.min(1, 0.2 + Math.abs(next - prev) * gain))

// MediaPipe face mesh indices: iris centre, iris edge pair, lid top/bottom, eye corners
const EYES = [
  { iris: 468, edge: [469, 471], lid: [159, 145], corner: [33, 133] },
  { iris: 473, edge: [474, 476], lid: [386, 374], corner: [362, 263] },
] as const

function eyeFrom(m: NormalizedLandmark[], e: (typeof EYES)[number], aspect: number): Eye {
  const dist = (a: number, b: number) => Math.hypot(m[a].x - m[b].x, (m[a].y - m[b].y) / aspect)
  return { x: m[e.iris].x, y: m[e.iris].y, r: dist(e.edge[0], e.edge[1]) / 2, open: dist(e.lid[0], e.lid[1]) / Math.max(dist(e.corner[0], e.corner[1]), 1e-4) }
}

export async function createFaceTracker() {
  const model = await load()
  let last: Face | undefined, lastTime = -1
  return {
    detect(video: HTMLVideoElement, now: number): Face | undefined {
      if (video.readyState < 2 || video.currentTime === lastTime) return last
      lastTime = video.currentTime
      const marks = model.detectForVideo(video, now).faceLandmarks[0]
      if (!marks) return (last = undefined)
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0
      for (let i = 0; i < 468; i++) { const p = marks[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
      const aspect = video.videoWidth / video.videoHeight
      const raw: Face = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, eyes: [eyeFrom(marks, EYES[0], aspect), eyeFrom(marks, EYES[1], aspect)] }
      if (!last) return (last = raw)
      const l = last
      const eye = (a: Eye, b: Eye): Eye => ({ x: follow(a.x, b.x, 40), y: follow(a.y, b.y, 40), r: follow(a.r, b.r), open: lerp(a.open, b.open, 0.6) })
      return (last = { x: follow(l.x, raw.x), y: follow(l.y, raw.y), w: follow(l.w, raw.w), eyes: [eye(l.eyes[0], raw.eyes[0]), eye(l.eyes[1], raw.eyes[1])] })
    },
    reset() { last = undefined; lastTime = -1 },
  }
}

const HAND_MODEL_URL = '/models/hand_landmarker.task'

/** Where a held light sits: the middle of the palm, in video fractions, plus how big the hand looks (closer = bigger) */
export type Hand = { x: number; y: number; size: number }

let handModel: Promise<HandLandmarker> | undefined
function loadHands() {
  return handModel ??= import('@mediapipe/tasks-vision').then(async ({ HandLandmarker, FilesetResolver }) => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
    const make = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.35 })
    return make('GPU').catch(() => make('CPU'))
  }).catch(e => { handModel = undefined; throw e })
}

export async function createHandTracker() {
  const model = await loadHands()
  let last: Hand | undefined, lastTime = -1
  return {
    detect(video: HTMLVideoElement, now: number): Hand | undefined {
      if (video.readyState < 2 || video.currentTime === lastTime) return last
      lastTime = video.currentTime
      const m = model.detectForVideo(video, now).landmarks[0]
      if (!m) return (last = undefined)
      // palm centre from the wrist and knuckles, nudged toward the fingers where a bulb would be held
      const palm = [0, 5, 9, 13, 17].map(i => m[i])
      const cx = palm.reduce((s, p) => s + p.x, 0) / palm.length, cy = palm.reduce((s, p) => s + p.y, 0) / palm.length
      const aspect = video.videoWidth / video.videoHeight
      const raw: Hand = { x: cx + (m[9].x - cx) * 0.35, y: cy + (m[9].y - cy) * 0.35, size: Math.hypot(m[0].x - m[9].x, (m[0].y - m[9].y) / aspect) }
      return (last = last ? { x: follow(last.x, raw.x, 30), y: follow(last.y, raw.y, 30), size: follow(last.size, raw.size) } : raw)
    },
  }
}
