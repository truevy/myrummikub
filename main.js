const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell, systemPreferences, Tray } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// A second copy of the app can run with its own data folder, which is how two
// online players are tried out on one Mac: electron . --profile-dir=/tmp/other
const profileDir = process.argv.find((a) => a.startsWith('--profile-dir='));
if (profileDir) app.setPath('userData', path.resolve(profileDir.slice('--profile-dir='.length)));

// The game has been called "Lynda's Rummi Tummi", "Rummi-Tumi" and "Lynda's
// Rummikub" before. The
// first time the renamed app starts, it takes over the most recent old data
// folder (players, statistics, settings and this computer's online identity)
// so that nothing is lost.
if (!profileDir) {
  try {
    const fsSync = require('fs');
    const now = app.getPath('userData');
    const fresh = !fsSync.existsSync(path.join(now, 'profiles.json')) && !fsSync.existsSync(path.join(now, 'settings.json'));
    const before = ["Lynda's Rummi Tummi", 'Rummi-Tumi', "Lynda's Rummikub"]
      .map((name) => path.join(app.getPath('appData'), name))
      .find((dir) => dir !== now && (fsSync.existsSync(path.join(dir, 'profiles.json')) || fsSync.existsSync(path.join(dir, 'settings.json'))));
    if (fresh && before) fsSync.cpSync(before, now, { recursive: true });
  } catch (err) {
    // starting fresh is fine
  }
}

// Invitation links look like rummi-tummi://join?t=… and open this app.
const SCHEME = 'rummi-tummi';
const RELEASES_URL = 'https://github.com/truevy/myrummikub/';
const SIGNIN_URL = 'https://lyndas-rummikub.web.app/signin.html'; // Sign in with Apple happens in the browser
let pendingUrl = null;
let mainWindow = null;
// Notifications ("your turn") are shown by the game page, so the page has to
// keep running. While the player is online, closing the window only hides it:
// on a Mac the game stays in the Dock, on Windows it stays in the tray.
let keepRunning = false;
let quitting = false;
let tray = null;
let toldAboutTray = false;
// Windows shows notifications under this id (it is also the Mac bundle id)
app.setAppUserModelId('com.myrummikub.app');
const isJoinUrl = (u) => typeof u === 'string' && u.toLowerCase().startsWith(SCHEME + '://');
function takeUrl(url) {
  if (!isJoinUrl(url)) return;
  pendingUrl = url;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cloud:url', url);
    showWindow();
  }
}

// Only one copy per data folder; a second launch hands its link to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => takeUrl(argv.find(isJoinUrl)));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    takeUrl(url);
  });
  // The installed app owns the link scheme (it is also declared in its
  // Info.plist). A copy run from source must not claim it: macOS would then
  // hand invitation links to a bare Electron instead of the game.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
  else app.removeAsDefaultProtocolClient(SCHEME);
  takeUrl(process.argv.find(isJoinUrl));
}

// The page is served from its own app:// origin rather than file://, so that
// the browser-side storage the online features rely on (sign-in persistence)
// has a stable, secure origin to live under.
const APP_ORIGIN = 'app://rummikub';
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const SERVED = ['index.html', 'src/', 'vendor/'];
function serveApp(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(__dirname, pathname));
  const inside = file.startsWith(__dirname + path.sep);
  const allowed = SERVED.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
  if (!inside || !allowed || pathname.includes('..')) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

const SAVE_FILTERS = [{ name: 'Rummi Time game', extensions: ['rummitime', 'rummikub'] }];
const MAX_SAVE_BYTES = 4 * 1024 * 1024;
// Settings and player profiles live as JSON files in the app's data folder.
// ('profiles' belongs to versions before 3.0 and is no longer read; 3.0 uses 'profiles3')
const STORES = ['settings', 'profiles', 'profiles3'];
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const storePath = (name) => path.join(app.getPath('userData'), name + '.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: '#1b1f2a',
    title: `${app.getName()} ${app.getVersion()}`,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false, // a hidden window must still notice that it is somebody's turn
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // the window title carries the version; the page's own title must not replace it
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (quitting || !keepRunning) return;
    event.preventDefault();
    win.hide();
    if (process.platform !== 'darwin') {
      makeTray();
      if (!toldAboutTray && tray) {
        toldAboutTray = true;
        tray.displayBalloon({ title: "Lynda's Rummi Time is still running", content: 'You will be told when it is your turn. Right-click this icon to quit.', noSound: true });
      }
    }
  });
  win.loadURL(APP_ORIGIN + '/index.html');
  mainWindow = win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// The icon that keeps a hidden game within reach on Windows and Linux.
function makeTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(path.join(__dirname, 'resources', 'tray.png'));
  if (image.isEmpty()) return;
  tray = new Tray(image);
  tray.setToolTip("Lynda's Rummi Time");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open the game', click: showWindow },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
}

ipcMain.on('bg:keep', (event, yes) => {
  keepRunning = yes === true;
});
ipcMain.on('bg:show', () => showWindow());

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('cloud:pendingUrl', () => {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
});

// Opens Messages, Mail or the download page; nothing else may be opened.
ipcMain.handle('cloud:openExternal', async (event, url) => {
  if (typeof url !== 'string') throw new Error('Bad link.');
  const ok = /^(sms|imessage|mailto):/i.test(url) || url.startsWith(RELEASES_URL) || url.startsWith(SIGNIN_URL);
  if (!ok) throw new Error('That kind of link cannot be opened.');
  await shell.openExternal(url);
  return true;
});

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
  protocol.handle('app', serveApp);
  // the page may use the camera (profile photos) and show notifications ("your turn"), nothing else
  const ours = (webContents) => webContents.getURL().startsWith(APP_ORIGIN + '/');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const video = permission === 'media' && (details.mediaTypes || []).every((t) => t === 'video');
    callback((video || permission === 'notifications') && ours(webContents));
  });
  // Notification.permission in the page asks this
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (permission === 'notifications' || permission === 'media') && !!webContents && ours(webContents));
  createWindow();
  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
