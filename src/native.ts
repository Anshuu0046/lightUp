import { Capacitor } from '@capacitor/core'

/** True inside the Android app (Capacitor), false in browsers and the Windows app */
export const isNative = Capacitor.isNativePlatform()

/**
 * Saves a finished file where the user can find it.
 * Browser / Windows: a normal download. Android: writes to Documents/Light Up, then opens the share sheet
 * so it can go straight to Instagram, YouTube, WhatsApp, Drive or the gallery.
 * Returns where it went, for the confirmation message.
 */
export async function saveFile(blob: Blob, name: string): Promise<string> {
  if (!isNative) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    return 'Downloads'
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const path = `Light Up/${name}`
  // write in chunks: one base64 string of a whole video would exhaust memory on a phone
  const CHUNK = 3 * 1024 * 1024 // a multiple of 3 bytes, so each chunk encodes to standalone base64
  for (let at = 0; at < blob.size || at === 0; at += CHUNK) {
    const data = await toBase64(blob.slice(at, at + CHUNK))
    if (at === 0) await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true })
    else await Filesystem.appendFile({ path, data, directory: Directory.Documents })
    if (blob.size === 0) break
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents })
  const { Share } = await import('@capacitor/share')
  await Share.share({ title: name, files: [uri] }).catch(() => { /* closed the share sheet; the file is still saved */ })
  return 'Documents › Light Up'
}

function toBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}
