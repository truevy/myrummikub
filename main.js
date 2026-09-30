const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const SAVE_FILTERS = [{ name: 'Rummikub game', extensions: ['rummikub'] }];
const MAX_SAVE_BYTES = 1024 * 1024;

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
