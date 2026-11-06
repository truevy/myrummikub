const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('the iPhone and iPad app keeps the screen on when the page asks, and a Mac never offers it', () => {
  const swift = read('ios/RummiTummi/GameView.swift');
  assert.match(swift, /case "keepAwake":\s+UIApplication\.shared\.isIdleTimerDisabled = body\["on"\]/);
  assert.match(swift, /#if targetEnvironment\(macCatalyst\)\s+private static let awakeScript = ""/);
  assert.match(swift, /\\\(awakeScript\)/);
});

test('the screen stays on unless the player allows sleep, and only where the app can do it', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /allowSleep: false,/);
  assert.match(ui, /settings\.allowSleep = saved\.allowSleep === true;/);
  assert.match(ui, /window\.rkAwake\.set\(!settings\.allowSleep\)/);
  assert.match(ui, /window\.rkAwake\s+\? `<div class="setting"><div class="label">Screen<\/div>/);
  assert.match(ui, /applySettings\(saved\);\s+applyAwake\(\);/);
});
