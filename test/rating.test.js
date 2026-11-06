const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Apple’s rating prompt is asked for after a win, once a few games are played, and not often', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /const youWon = isMe\(w\.id\);\s+if \(youWon\) askForRating\(\);/);
  assert.match(ui, /if \(!window\.rkReview \|\| db\.games\.length < 3 \|\| Date\.now\(\) - settings\.reviewAskedAt < REVIEW_GAP_MS\) return;/);
  assert.match(ui, /settings\.reviewAskedAt = Number\(saved\.reviewAskedAt\) \|\| 0;/);
  const swift = read('ios/RummiTummi/GameView.swift');
  assert.match(swift, /case "review":[\s\S]{0,300}AppStore\.requestReview\(in: scene\)/);
  assert.match(swift, /window\.rkReview = \{ ask: \(\) => call\(\{ cmd: 'review' \}\) \};/);
});

test('the App Store fields fit, and the keywords repeat no word of the name or subtitle', () => {
  const doc = read('docs/app-store-listing.md');
  const name = doc.match(/\| App name \(30 max\) \| (.+?) \|/)[1];
  const subtitle = doc.match(/\| Subtitle \(30 max\) \| (.+?) \|/)[1];
  const keywords = doc.match(/## Keywords[^\n]*\n\n(.+)\n/)[1];
  assert.ok(name.length <= 30 && subtitle.length <= 30 && keywords.length <= 100);
  assert.doesNotMatch(keywords, /, /, 'no spaces after the commas');
  const used = new Set((name + ' ' + subtitle).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/));
  for (const k of keywords.split(',')) assert.ok(!used.has(k), `"${k}" is already in the name or subtitle`);
  assert.doesNotMatch(keywords, /rummikub/i);
});
