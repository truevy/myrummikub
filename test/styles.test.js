const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const zOf = (selector) => {
  const m = css.match(new RegExp('(^|\\n)' + selector.replace(/[#.]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  const z = m && /z-index:\s*(\d+)/.exec(m[2]);
  return z ? +z[1] : null;
};

// The lobby, the settings and every other dialog are drawn in #overlay. A message
// that sits below it is invisible exactly when it matters, so the player sees
// "nothing happens".
test('messages (#toast) are drawn above the dialogs and the banners', () => {
  const toast = zOf('#toast');
  const overlay = zOf('#overlay');
  assert.ok(toast !== null && overlay !== null, 'both have a z-index');
  assert.ok(toast > overlay, `#toast (${toast}) is above #overlay (${overlay})`);
  const banner = /#turn-alert[^{]*\{[^}]*z-index:\s*(\d+)/.exec(css);
  assert.ok(banner && toast > +banner[1], 'and above the turn banner');
});
