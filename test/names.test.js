const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
const block = src.slice(src.indexOf('const AI_NAMES = ['), src.indexOf('];', src.indexOf('const AI_NAMES = [')));
const names = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('the computer players have a hundred names more than the original thirteen', () => {
  assert.ok(names.length >= 113, `only ${names.length} names`);
  for (const original of ['Nina', 'Sara', 'Jackie', 'Christina', 'Alex', 'Enis', 'Mark', 'Layla', 'Zac', 'Hannah', 'Bilbo', 'Emily', 'Kookie']) {
    assert.ok(names.includes(original), `${original} is still there`);
  }
});

test('every name is plain, short enough for a player panel, and used once', () => {
  assert.strictEqual(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'no name twice');
  for (const n of names) assert.match(n, /^[A-Z][a-z]{1,11}$/, n);
});

test('the big-move celebration says "Rummi Time!" unless the player chose something else', () => {
  assert.match(src, /const DEFAULT_CHEER = 'Rummi Time!';/);
  assert.match(src, /saved\.celebrateText\.trim\(\) !== OLD_DEFAULT_CHEER/, 'the old saved default does not stick');
  assert.doesNotMatch(src.replace(/OLD_DEFAULT_CHEER = 'Scrabalicious!'/, ''), /Scrabalicious/);
});
