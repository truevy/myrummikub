const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'ios', 'screenshots');
// width, height and whether there is an alpha channel, from a PNG's header
function png(file) {
  const b = fs.readFileSync(path.join(dir, file));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 };
}

test('the splash screen is the first App Store screenshot of every set, at the size Apple asks for', () => {
  const sizes = { iphone: [2622, 1206], ipad: [2752, 2064], mac: [2880, 1800] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  for (const [device, [w, h]] of Object.entries(sizes)) {
    const set = files.filter((f) => f.startsWith(device + '-')).sort();
    assert.strictEqual(set[0], `${device}-1-splash.png`);
    assert.deepStrictEqual(set.map((f) => Number(f.split('-')[1])), set.map((_, i) => i + 1), `${device}: numbered 1, 2, 3… without gaps`);
    for (const f of set) {
      const p = png(f);
      assert.deepStrictEqual([p.w, p.h], [w, h], f);
      assert.strictEqual(p.alpha, false, `${f} has no alpha channel (App Store Connect refuses it)`);
    }
  }
});
