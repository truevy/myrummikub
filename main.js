const { app, BrowserWindow, dialog, ipcMain, session, systemPreferences } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const SAVE_FILTERS = [{ name: 'Rummikub game', extensions: ['rummikub'] }];
const MAX_SAVE_BYTES = 4 * 1024 * 1024;
// Settings and player profiles live as JSON files in the app's data folder.
const STORES = ['settings', 'profiles'];
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const storePath = (name) => path.join(app.getPath('userData'), name + '.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: '#0b3b2e',
    title: "Lynda's Rummikub",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('game:save', async (event, suggestedName, text) => {
  if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES) throw new Error('Nothing to save.');
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save game',
    defaultPath: path.join(app.getPath('documents'), path.basename(String(suggestedName))),
    filters: SAVE_FILTERS,
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, text, 'utf8');
  return path.basename(filePath);
});

ipcMain.handle('game:load', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Load game',
    defaultPath: app.getPath('documents'),
    filters: SAVE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  const stat = await fs.stat(filePaths[0]);
  if (stat.size > MAX_SAVE_BYTES) throw new Error('That file is too large to be a saved game.');
  return { name: path.basename(filePaths[0]), text: await fs.readFile(filePaths[0], 'utf8') };
});

ipcMain.handle('store:read', async (event, name) => {
  if (!STORES.includes(name)) throw new Error('Unknown store.');
  try {
    return JSON.parse(await fs.readFile(storePath(name), 'utf8'));
  } catch (err) {
    return null; // missing or unreadable: the page falls back to defaults
  }
});

// Writes to one file are done one after another, in the order they were asked
// for, so that two quick changes cannot overtake or trip over each other.
const writeQueue = {};
ipcMain.handle('store:write', (event, name, data) => {
  if (!STORES.includes(name)) throw new Error('Unknown store.');
  const text = JSON.stringify(data, null, 1);
  if (text.length > MAX_STORE_BYTES) throw new Error('Too much data to store.');
  const write = async () => {
    // write to a temporary file first so a crash cannot leave a half-written file
    const tmp = storePath(name) + '.tmp';
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, storePath(name));
    return true;
  };
  writeQueue[name] = (writeQueue[name] || Promise.resolve()).then(write, write);
  return writeQueue[name];
});

ipcMain.handle('camera:ask', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
  return systemPreferences.askForMediaAccess('camera');
});

app.whenReady().then(() => {
  // the only permission the page may use is the camera, for profile photos
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const video = permission === 'media' && (details.mediaTypes || []).every((t) => t === 'video');
    callback(video && webContents.getURL().startsWith('file://'));
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
