// Gives the game page access to the native dialogs, the config files and the
// camera permission prompt, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rkFiles', {
  // resolves to the saved file's name, or null if the dialog was cancelled
  save: (suggestedName, text) => ipcRenderer.invoke('game:save', suggestedName, text),
  // resolves to { name, text }, or null if the dialog was cancelled
  load: () => ipcRenderer.invoke('game:load'),
});

contextBridge.exposeInMainWorld('rkStore', {
  // name is 'settings' or 'profiles'; resolves to the stored object or null
  read: (name) => ipcRenderer.invoke('store:read', name),
  write: (name, data) => ipcRenderer.invoke('store:write', name, data),
  // asks macOS for camera access; resolves to true if it was granted
  askCamera: () => ipcRenderer.invoke('camera:ask'),
});
