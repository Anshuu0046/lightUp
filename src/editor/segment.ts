import type { ImageSegmenter } from '@mediapipe/tasks-vision'

/** Person cut-outs with MediaPipe's selfie segmenter (bundled, ~250 KB). Runs per frame, on the GPU when possible. */
let model: Promise<ImageSegmenter> | undefined
let ready: ImageSegmenter | null = null

export function loadSegmenter() {
  return model ??= import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, ImageSegmenter }) => {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false })
    ready = await make('GPU').catch(() => make('CPU'))
    return ready
  }).catch(e => { model = undefined; throw e })
}
export const segmenterReady = () => !!ready

// the last mask, so redrawing the same paused frame doesn't run the model again
let lastKey = ''
let lastMask: OffscreenCanvas | null = null
const maskCanvas = () => new OffscreenCanvas(1, 1)

/**
 * A soft alpha mask of the person in `src` (white = keep). `threshold` moves the edge in or out,
 * `feather` softens it. Returns null until the model has loaded.
 */
export function personMask(src: TexImageSource, key: string, threshold = 0.5, feather = 0.3): OffscreenCanvas | null {
  if (!ready) return null
  const k = `${key}|${threshold}|${feather}`
  if (k === lastKey && lastMask) return lastMask
  const result = ready.segment(src as HTMLCanvasElement)
  const mask = result.confidenceMasks?.[0]
  if (!mask) { result.close(); return null }
  const w = mask.width, h = mask.height, conf = mask.getAsFloat32Array()
  const c = lastMask && lastMask.width === w && lastMask.height === h ? lastMask : Object.assign(maskCanvas(), { width: w, height: h })
  const g = c.getContext('2d')!, img = g.createImageData(w, h)
  // map confidence to alpha with a soft ramp around the threshold
  const soft = 0.02 + feather * 0.3, lo = threshold - soft, hi = threshold + soft
  for (let i = 0; i < conf.length; i++) {
    const a = Math.min(1, Math.max(0, (conf[i] - lo) / (hi - lo)))
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = a * 255
  }
  g.putImageData(img, 0, 0)
  result.close()
  lastKey = k; lastMask = c
  return c
}
