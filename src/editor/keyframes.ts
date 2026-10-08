import type { Clip, Keyframe, Transform } from './model'

export type Pose = Transform & { opacity: number }

const smooth = (u: number) => u * u * (3 - 2 * u)
const mix = (a: number, b: number, u: number) => a + (b - a) * u

const poseOf = (k: Keyframe): Pose => ({ x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity })

/** Where a clip sits at timeline time t: its own transform, or eased between its keyframes */
export function poseAt(c: Clip, t: number): Pose {
  const keys = c.keys
  if (!keys?.length) return { ...c.transform, opacity: c.opacity }
  const local = t - c.start
  if (local <= keys[0].t) return poseOf(keys[0])
  const last = keys[keys.length - 1]
  if (local >= last.t) return poseOf(last)
  let i = 1
  while (keys[i].t < local) i++
  const a = keys[i - 1], b = keys[i], u = smooth((local - a.t) / Math.max(1e-6, b.t - a.t))
  return { x: mix(a.x, b.x, u), y: mix(a.y, b.y, u), scale: mix(a.scale, b.scale, u), rotation: mix(a.rotation, b.rotation, u), opacity: mix(a.opacity, b.opacity, u) }
}

/** Puts a keyframe at local time `at` (replacing one within a frame of it), keeping the list in order */
export function setKey(keys: Keyframe[], at: number, pose: Pose): Keyframe[] {
  const next = keys.filter(k => Math.abs(k.t - at) > 0.04)
  next.push({ t: Math.max(0, at), x: pose.x, y: pose.y, scale: pose.scale, rotation: pose.rotation, opacity: pose.opacity })
  return next.sort((a, b) => a.t - b.t)
}

/**
 * The patch for changing part of a clip's pose at time t: written into the keyframe at the playhead if the clip
 * is animated, otherwise into its plain transform. Used by the sliders and by dragging on the preview.
 */
export function withPose(c: Clip, t: number, p: Partial<Pose>): Partial<Clip> {
  const now = { ...poseAt(c, t), ...p }
  if (c.keys?.length) return { keys: setKey(c.keys, t - c.start, now) }
  return { transform: { x: now.x, y: now.y, scale: now.scale, rotation: now.rotation }, opacity: now.opacity }
}

/** A clip cut at local time `at` becomes two; each keeps its keyframes (re-timed) plus one at the cut so the motion carries across */
export function splitKeys(c: Clip, at: number): [Keyframe[] | undefined, Keyframe[] | undefined] {
  if (!c.keys?.length) return [undefined, undefined]
  const edge = poseAt(c, c.start + at)
  const cut: Keyframe = { t: at, x: edge.x, y: edge.y, scale: edge.scale, rotation: edge.rotation, opacity: edge.opacity }
  const before = [...c.keys.filter(k => k.t < at - 0.04), cut]
  const after = [{ ...cut, t: 0 }, ...c.keys.filter(k => k.t > at + 0.04).map(k => ({ ...k, t: k.t - at }))]
  return [before, after]
}

export const MOTIONS = [
  { id: 'zoomIn', name: 'Slow zoom in' },
  { id: 'zoomOut', name: 'Zoom out' },
  { id: 'panRight', name: 'Drift right' },
  { id: 'panLeft', name: 'Drift left' },
  { id: 'pop', name: 'Pop in' },
  { id: 'spin', name: 'Spin in' },
] as const
export type MotionId = (typeof MOTIONS)[number]['id']

/** Two or three keyframes that give a clip a move, starting from where it sits now */
export function motionKeys(c: Clip, id: MotionId, length: number): Keyframe[] {
  const b: Pose = { ...c.transform, opacity: c.opacity }
  const k = (t: number, p: Partial<Pose>): Keyframe => ({ t, ...b, ...p })
  const quick = Math.min(0.45, length / 2)
  switch (id) {
    case 'zoomIn': return [k(0, {}), k(length, { scale: b.scale * 1.3 })]
    case 'zoomOut': return [k(0, { scale: b.scale * 1.3 }), k(length, {})]
    case 'panRight': return [k(0, { x: b.x - 0.08, scale: b.scale * 1.15 }), k(length, { x: b.x + 0.08, scale: b.scale * 1.15 })]
    case 'panLeft': return [k(0, { x: b.x + 0.08, scale: b.scale * 1.15 }), k(length, { x: b.x - 0.08, scale: b.scale * 1.15 })]
    case 'pop': return [k(0, { scale: b.scale * 0.5, opacity: 0 }), k(quick, {})]
    case 'spin': return [k(0, { scale: b.scale * 0.4, rotation: b.rotation - 180, opacity: 0 }), k(Math.min(0.7, length / 2), {})]
  }
}
