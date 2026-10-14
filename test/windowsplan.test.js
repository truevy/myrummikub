const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'windows-release-plan.sh');
const VERSION = require('../package.json').version;

// A fake `gh` that lists the files of the release for the version: none when there is no
// release (it fails), or the given names.
function plan(env, { released = false, assets = ['Lyndas-Rummi-Time-1.0.0-windows-x64.zip'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const body = released ? `printf '%s\\n' ${assets.map((a) => `'${a}'`).join(' ')}` : 'exit 1';
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const r = spawnSync('bash', [SCRIPT], { env: { ...process.env, PATH: dir + ':' + process.env.PATH, EVENT: '', REF_TYPE: '', REF_NAME: '', INPUT_TAG: '', ...env }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=')));
}

test('a push to main publishes the version in package.json when it has no release yet', () => {
  assert.deepStrictEqual(plan({ EVENT: 'push', REF_TYPE: 'branch', REF_NAME: 'main' }), { tag: 'v' + VERSION, build: 'true' });
});

test('a push to main does nothing when that version is already released', () => {
  const r = plan({ EVENT: 'push', REF_TYPE: 'branch', REF_NAME: 'main' }, { released: true });
  assert.deepStrictEqual(r, { tag: 'v' + VERSION, build: 'false' });
});

test('a release that exists but has no Windows zips (a failed run) is filled in', () => {
  const r = plan({ EVENT: 'push', REF_TYPE: 'branch', REF_NAME: 'main' }, { released: true, assets: [] });
  assert.deepStrictEqual(r, { tag: 'v' + VERSION, build: 'true' });
  const other = plan({ EVENT: 'push', REF_TYPE: 'branch', REF_NAME: 'main' }, { released: true, assets: ['notes.txt'] });
  assert.strictEqual(other.build, 'true');
});

test('pushing a tag publishes that tag, even if a release exists (the zips are replaced)', () => {
  assert.deepStrictEqual(plan({ EVENT: 'push', REF_TYPE: 'tag', REF_NAME: 'v3.0.2' }, { released: true }), { tag: 'v3.0.2', build: 'true' });
});

test('Run workflow publishes the tag typed in, or only keeps the zips when it is empty', () => {
  assert.deepStrictEqual(plan({ EVENT: 'workflow_dispatch', INPUT_TAG: 'v3.0.2' }), { tag: 'v3.0.2', build: 'true' });
  assert.deepStrictEqual(plan({ EVENT: 'workflow_dispatch', INPUT_TAG: '' }), { tag: '', build: 'true' });
});
