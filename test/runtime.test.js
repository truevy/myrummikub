const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the Cloud Functions run on a supported Node version, and the same one everywhere it is named', () => {
  const firebase = JSON.parse(read('firebase.json'));
  const fn = [].concat(firebase.functions)[0];
  const major = Number(String(fn.runtime).replace('nodejs', ''));
  assert.ok(major >= 22, `${fn.runtime} is no longer supported by Firebase (Node 20 was withdrawn on 2026-10-30)`);
  const engines = JSON.parse(read('functions/package.json')).engines.node;
  assert.strictEqual(Number(engines), major, 'functions/package.json says the same version as firebase.json');
});

test('the build workflows use a Node version the app\'s dependencies support', () => {
  for (const wf of ['.github/workflows/testflight.yml', '.github/workflows/windows.yml']) {
    const m = read(wf).match(/node-version: (\d+)/);
    assert.ok(m && Number(m[1]) >= 22, `${wf} uses Node ${m && m[1]}; Electron 44 needs 22.12 or newer`);
  }
});
