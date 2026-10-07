/** GPU canvases are blank once their frame is presented, so a canvas someone wants to read is copied right after it renders. */
const wanted = new WeakSet<HTMLCanvasElement>()
const copies = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

export function snapAfterRender(source: HTMLCanvasElement) {
  if (!wanted.has(source)) return
  let copy = copies.get(source)
  if (!copy) copies.set(source, copy = document.createElement('canvas'))
  if (copy.width !== source.width || copy.height !== source.height) { copy.width = source.width; copy.height = source.height }
  copy.getContext('2d')!.drawImage(source, 0, 0)
}

/** Returns the latest rendered copy, and keeps copies coming while `release` hasn't been called */
export function watch(source: HTMLCanvasElement) { wanted.add(source); return copies.get(source) }
export function release(source: HTMLCanvasElement) { wanted.delete(source) }
