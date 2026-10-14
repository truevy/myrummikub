const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const kt = read('android/app/src/main/java/com/lyndasrummitummi/android/MainActivity.kt');

test('every request the Android page script makes is answered by the app, and the other way round', () => {
  const script = kt.slice(kt.indexOf('PAGE_SCRIPT = """'));
  const asked = new Set([...script.matchAll(/cmd: '(\w+)'/g)].map((m) => m[1]));
  const handled = new Set([...kt.slice(0, kt.indexOf('companion object')).matchAll(/^\s+"(\w+)"(?: ->|,)/gm)].map((m) => m[1]));
  for (const cmd of asked) assert.ok(handled.has(cmd), `the app does not handle "${cmd}"`);
  for (const cmd of handled) assert.ok(asked.has(cmd), `the page never asks for "${cmd}"`);
});

test('the Android push bridge has the same shape as the iPhone one', () => {
  const ios = read('ios/RummiTummi/GameView.swift');
  for (const fn of ['register', 'status', 'openSettings', 'pendingGame', 'clearBadge']) {
    assert.match(kt, new RegExp(`${fn}: function`), `Android lacks rkPush.${fn}`);
    assert.match(ios, new RegExp(`${fn}: \\(\\)`), `iOS lacks rkPush.${fn}`);
  }
  // what the page does with the answer: save the token with its kind
  assert.match(read('src/ui.js'), /reg\.env === 'fcm' \? 'fcm'/);
  assert.match(kt, /put\("env", "fcm"\)/);
});

test('the manifest asks for what the app uses, and the web files are copied into it', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const p of ['INTERNET', 'CAMERA', 'POST_NOTIFICATIONS']) assert.match(manifest, new RegExp(`android.permission.${p}`));
  assert.match(manifest, /android:scheme="rummi-tummi"/);
  assert.match(manifest, /com\.google\.firebase\.MESSAGING_EVENT/);
  assert.match(manifest, /default_notification_channel_id"\s+android:value="turns"/);
  const gradle = read('android/app/build.gradle.kts');
  for (const dir of ['index.html', 'src', 'vendor']) assert.match(gradle, new RegExp(`from\\("../../${dir}"`));
  assert.match(gradle, /package\.json/, 'the version is the game\'s own');
  // the channel the server names in each message exists in the app
  assert.match(read('functions/routing.js'), /channelId: 'turns'/);
  assert.match(read('android/app/src/main/java/com/lyndasrummitummi/android/TurnMessagingService.kt'), /TURNS = "turns"/);
});

test('the workflow builds the Android app into the same release', () => {
  const wf = read('.github/workflows/windows.yml');
  assert.match(wf, /\n  android:\n/);
  assert.match(wf, /scripts\/build-android\.sh/);
  assert.match(wf, /gh release upload "\$TAG" dist\/\*\.apk/);
});
