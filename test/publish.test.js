const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'publish-windows-release.sh');
const VERSION = require('../package.json').version;

// A fake `gh` that writes down what it was asked and says whether a release exists.
function setup({ exists }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-'));
  const bin = path.join(dir, 'bin');
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(bin);
  fs.mkdirSync(dist);
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/bash
echo "$*" | tr '\n' ' ' >> "${log}"; echo >> "${log}"
if [[ "$1 $2" == "release view" ]]; then
  if [[ "$*" == *"--json"* ]]; then echo "https://github.com/truevy/myrummikub/releases/tag/v${VERSION}"; exit 0; fi
  ${exists ? 'exit 0' : 'exit 1'}
fi
exit 0
`,
    { mode: 0o755 }
  );
  for (const arch of ['x64', 'arm64']) fs.writeFileSync(path.join(dist, `Lyndas-Rummi-Time-${VERSION}-windows-${arch}.zip`), 'zip');
  const summary = path.join(dir, 'summary.md');
  const run = (tag) =>
    spawnSync('bash', [SCRIPT, tag], {
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, DIST_DIR: dist, GITHUB_SHA: 'abc123', GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return { run, calls, summary, dist };
}

test('with no release yet, it creates one at the commit and attaches both zips', () => {
  const t = setup({ exists: false });
  const r = t.run('v' + VERSION);
  assert.strictEqual(r.status, 0, r.stderr);
  const calls = t.calls();
  const create = calls.filter((c) => c.startsWith('release create'));
  assert.strictEqual(create.length, 1);
  assert.match(create[0], new RegExp(`release create v${VERSION} --target abc123`));
  assert.match(create[0], /Windows protected your PC/);
  const upload = calls.filter((c) => c.startsWith('release upload'));
  assert.strictEqual(upload.length, 1);
  assert.match(upload[0], new RegExp(`windows-arm64\\.zip`));
  assert.match(upload[0], new RegExp(`windows-x64\\.zip`));
  assert.match(upload[0], /--clobber/);
});

test('with a release already there, it only adds the zips', () => {
  const t = setup({ exists: true });
  const r = t.run('v' + VERSION);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(t.calls().filter((c) => c.startsWith('release create')).length, 0, 'the release is not created again');
  assert.strictEqual(t.calls().filter((c) => c.startsWith('release upload')).length, 1);
});

test('the run summary lists the release page and the direct download of each zip', () => {
  const t = setup({ exists: false });
  t.run('v' + VERSION);
  const md = fs.readFileSync(t.summary, 'utf8');
  assert.match(md, new RegExp(`releases/tag/v${VERSION}`));
  assert.match(md, new RegExp(`https://github.com/truevy/myrummikub/releases/download/v${VERSION}/Lyndas-Rummi-Time-${VERSION}-windows-x64\\.zip`));
});

test('a tag that is not the version in package.json is refused before anything is published', () => {
  const t = setup({ exists: false });
  const r = t.run('v9.9.9');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`package.json says ${VERSION.replace(/\./g, '\\.')}`));
  assert.deepStrictEqual(t.calls(), []);
});

test('a tag that is not a version, and missing zips, are refused', () => {
  const t = setup({ exists: false });
  const bad = t.run('main');
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /version tag/);
  for (const f of fs.readdirSync(t.dist)) fs.unlinkSync(path.join(t.dist, f));
  const none = t.run('v' + VERSION);
  assert.notStrictEqual(none.status, 0);
  assert.match(none.stderr, /No Windows zips/);
  assert.deepStrictEqual(t.calls(), []);
});
