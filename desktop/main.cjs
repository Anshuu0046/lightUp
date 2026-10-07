// Light Up desktop shell: runs the web app and pipes its lit frames into the Light Up Camera.
const { app, BrowserWindow, ipcMain, session, protocol, net } = require('electron')
const { pathToFileURL } = require('url')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const FRAME_BYTES = 1280 * 720 * 4
const CAMERA_DLL = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Light Up Camera', 'lightup_vcam.dll')
const feederPath = app.isPackaged ? path.join(process.resourcesPath, 'lightup_feed.exe') : path.join(__dirname, 'native', 'out', 'lightup_feed.exe')

let feeder = null
function startFeeder() {
  if (feeder || !fs.existsSync(feederPath)) return !!feeder
  feeder = spawn(feederPath, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
  feeder.on('exit', () => { feeder = null })
  feeder.stdin.on('error', () => {})
  return true
}
function stopFeeder() { if (feeder) { feeder.stdin.end(); feeder.kill(); feeder = null } }

ipcMain.handle('vcam:status', () => ({ installed: fs.existsSync(CAMERA_DLL), feeder: fs.existsSync(feederPath) }))
ipcMain.handle('vcam:start', () => startFeeder())
ipcMain.handle('vcam:stop', () => { stopFeeder() })
ipcMain.on('vcam:frame', (_e, data) => {
  if (!feeder || data.byteLength !== FRAME_BYTES) return
  if (feeder.stdin.writableLength > FRAME_BYTES) return // the camera is behind: drop this frame instead of queueing latency
  feeder.stdin.write(Buffer.from(data))
})

// the built app is served from app://lightup so it counts as a secure origin (camera, WebGPU, caches)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
const distDir = path.join(__dirname, '..', 'dist')

// LIGHTUP_HIDDEN=1 parks the window off-screen for automated checks (it must still be shown to receive camera frames)
const hidden = !!process.env.LIGHTUP_HIDDEN
if (hidden) for (const s of ['disable-renderer-backgrounding', 'disable-background-media-suspend', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(s)

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('enable-features', 'Vulkan')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#060609', title: 'Light Up', ...(hidden ? { x: -6000, y: 0, skipTaskbar: true, focusable: false } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.setMenuBarVisibility(false)
  // links and popups never open inside the app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !url.startsWith('http://localhost')) e.preventDefault() })
  const dev = process.env.LIGHTUP_DEV_URL
  if (dev) win.loadURL(dev)
  else win.loadURL('app://lightup/index.html')
}

app.whenReady().then(() => {
  // only the app's own pages may use the camera and microphone
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'mediaKeySystem'].includes(permission)))
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname)
    if (p === '/') p = '/index.html'
    const file = path.normalize(path.join(distDir, p))
    if (!file.startsWith(distDir)) return new Response('', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
})

// one copy of the app at a time: a second launch just brings the first to the front
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
// the packaged app may only load its own files: no network, no remote scripts
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self' data:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
app.whenReady().then(() => {
  if (process.env.LIGHTUP_DEV_URL) return
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
})
app.on('window-all-closed', () => { stopFeeder(); app.quit() })
