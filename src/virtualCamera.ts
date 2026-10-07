import { compositor } from './recorder'

export type LightUpBridge = {
  status: () => Promise<{ installed: boolean; feeder: boolean }>
  start: () => Promise<boolean>
  stop: () => Promise<void>
  sendFrame: (frame: ArrayBuffer) => void
}
export const bridge = (): LightUpBridge | undefined => (window as unknown as { lightup?: LightUpBridge }).lightup

const W = 1280, H = 720

/** Sends the lit picture (with ring and catchlights) to the Light Up Camera at 30 fps. Returns a stop function. */
export async function startVirtualCamera(stage: HTMLElement) {
  const api = bridge()
  if (!api) throw new Error('The virtual camera is only available in the Light Up desktop app.')
  const status = await api.status()
  if (!status.installed) throw new Error('Light Up Camera is not installed yet. Run the installer, then try again.')
  if (!await api.start()) throw new Error('Could not start the camera feeder.')
  const c = compositor(stage)
  const out = document.createElement('canvas'); out.width = W; out.height = H
  const g = out.getContext('2d', { willReadFrequently: true })!
  const timer = setInterval(() => {
    if (!c.draw()) return
    const s = Math.max(W / c.out.width, H / c.out.height)
    g.drawImage(c.out, (W - c.out.width * s) / 2, (H - c.out.height * s) / 2, c.out.width * s, c.out.height * s)
    api.sendFrame(g.getImageData(0, 0, W, H).data.buffer as ArrayBuffer)
  }, 33)
  return () => { clearInterval(timer); c.done(); api.stop() }
}
