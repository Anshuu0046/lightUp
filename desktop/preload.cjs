const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lightup', {
  status: () => ipcRenderer.invoke('vcam:status'),
  start: () => ipcRenderer.invoke('vcam:start'),
  stop: () => ipcRenderer.invoke('vcam:stop'),
  sendFrame: (buffer) => ipcRenderer.send('vcam:frame', buffer),
})
