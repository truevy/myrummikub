const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A handler assigned with `el.onkeydown = ...` that returns false cancels the event.
// `(e) => e.key === 'Enter' && go()` returns false for every other key, so the
// box it belonged to could not be typed in. Use addEventListener, or a block body.
test('no key or input handler is assigned as an expression that can return false', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  const bad = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.on(keydown|keyup|keypress|beforeinput|input|paste|submit)\s*=\s*(\([^)]*\)|\w+)\s*=>\s*[^{\s][^;]*(&&|\|\|)/.test(line));
  assert.deepStrictEqual(bad.map((b) => `src/ui.js:${b.n}: ${b.line.trim()}`), []);
});
