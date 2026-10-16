const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('the desktop app may show notifications and keeps running while online', () => {
  const main = read('main.js');
  assert.match(main, /permission === 'notifications'/, 'the permission request is allowed');
  assert.match(main, /setPermissionCheckHandler/, 'Notification.permission reads as granted');
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /ipcMain\.on\('bg:keep'/);
  assert.match(main, /setAppUserModelId/, 'Windows needs an id to show notifications');
  const preload = read('preload.js');
  assert.match(preload, /exposeInMainWorld\('rkPush'/);
  assert.match(preload, /kind: 'desktop'/);
  for (const name of ['keepRunning', 'showWindow']) assert.match(preload, new RegExp(name));
});

test('the tray icon ships inside the packaged Windows and Mac apps', () => {
  assert.ok(fs.existsSync(path.join(root, 'resources', 'tray.png')));
  for (const script of ['scripts/build-win.sh', 'scripts/build-mac.sh']) {
    const m = read(script).match(/--ignore='([^']*)'/);
    assert.ok(m, script + ' has an ignore list');
    assert.ok(!new RegExp(m[1]).test('/resources/tray.png'), script + ' must not leave the tray icon out');
  }
});

test('the window opens no larger than the screen, so the chat box at its bottom edge stays in view', () => {
  const main = read('main.js');
  assert.match(main, /screen\.getDisplayNearestPoint\(.*\)\.workArea/);
  assert.match(main, /\.\.\.windowSize\(\)/);
  assert.doesNotMatch(main, /height: 920,/, 'no fixed height taller than a laptop screen');
  assert.match(read('src/styles.css'), /#chat-form \{[^}]*flex: none/, 'the chat box is never squeezed out of its panel');
});
