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
  // the app's version number, e.g. "1.2.0"
  version: () => ipcRenderer.invoke('app:version'),
  // an invitation link the app was opened with, or null
  pendingUrl: () => ipcRenderer.invoke('cloud:pendingUrl'),
  // called for invitation links that arrive while the app is running
  onUrl: (cb) => ipcRenderer.on('cloud:url', (event, url) => cb(url)),
  // opens Messages, Mail or the download page with the given link
  openExternal: (url) => ipcRenderer.invoke('cloud:openExternal', url),
  // while online, closing the window hides the game instead of quitting it, so that
  // "your turn" can still be shown as a system notification
  keepRunning: (yes) => ipcRenderer.send('bg:keep', !!yes),
  // brings the game window back to the front (after a notification was clicked)
  showWindow: () => ipcRenderer.send('bg:show'),
});

// Notifications on a Mac or a Windows PC: the system's own, shown by the page while
// the game runs; no device token is involved. Same shape as the phone apps' bridge.
contextBridge.exposeInMainWorld('rkPush', {
  kind: 'desktop',
  register: async () => null,
  status: async () => 'granted',
  openSettings: async () => true,
  pendingGame: async () => null,
  clearBadge: async () => true,
});

contextBridge.exposeInMainWorld('rkStore', {
  // name is 'settings' or 'profiles3'; resolves to the stored object or null
  read: (name) => ipcRenderer.invoke('store:read', name),
  write: (name, data) => ipcRenderer.invoke('store:write', name, data),
  // asks macOS for camera access; resolves to true if it was granted
  askCamera: () => ipcRenderer.invoke('camera:ask'),
});
