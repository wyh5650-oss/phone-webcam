const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    // Server URL
    onServerUrl: (callback) => ipcRenderer.on('server-url', (_event, value) => {
        callback(value)
    }),
    getServerUrl: () => ipcRenderer.send('get-server-url'),

    // Virtual Camera
    startVirtualCam: (width, height) => ipcRenderer.invoke('vcam-start', { width, height }),
    stopVirtualCam: () => ipcRenderer.invoke('vcam-stop'),
    sendFrame: (buffer) => ipcRenderer.send('vcam-frame', buffer),
})
