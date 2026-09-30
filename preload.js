// Gives the game page access to the native save and open dialogs, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rkFiles', {
  // resolves to the saved file's name, or null if the dialog was cancelled
  save: (suggestedName, text) => ipcRenderer.invoke('game:save', suggestedName, text),
  // resolves to { name, text }, or null if the dialog was cancelled
  load: () => ipcRenderer.invoke('game:load'),
});
