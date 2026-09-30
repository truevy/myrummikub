// Gives the game page access to the native dialogs, the config files and the
// camera permission prompt, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rkFiles', {
  // resolves to the saved file's name, or null if the dialog was cancelled
  save: (suggestedName, text) => ipcRenderer.invoke('game:save', suggestedName, text),
  // resolves to { name, text }, or null if the dialog was cancelled
  load: () => ipcRenderer.invoke('game:load'),
});

contextBridge.exposeInMainWorld('rkCloud', {
  // true when running from source with `electron .`, where developer helpers show
  isDev: !process.argv.includes('--packaged') && !/\.app\/Contents\//.test(process.execPath),
  // an invitation link the app was opened with, or null
  pendingUrl: () => ipcRenderer.invoke('cloud:pendingUrl'),
  // called for invitation links that arrive while the app is running
  onUrl: (cb) => ipcRenderer.on('cloud:url', (event, url) => cb(url)),
  // opens Messages, Mail or the download page with the given link
  openExternal: (url) => ipcRenderer.invoke('cloud:openExternal', url),
});

contextBridge.exposeInMainWorld('rkStore', {
  // name is 'settings' or 'profiles'; resolves to the stored object or null
  read: (name) => ipcRenderer.invoke('store:read', name),
  write: (name, data) => ipcRenderer.invoke('store:write', name, data),
  // asks macOS for camera access; resolves to true if it was granted
  askCamera: () => ipcRenderer.invoke('camera:ask'),
});
