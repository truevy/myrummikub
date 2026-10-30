const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');

const CLOUD_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'cloud.js'), 'utf8');
function device(db, uid) {
  const self = {
    RK: { lobby, newId: () => 'f'.repeat(32), CLOUD: { inviteTtlMs: 1, firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } } },
    firebase: db.firebaseFor(uid),
  };
  new Function('self', CLOUD_SRC)(self);
  return self.RK.cloud;
}

test('a test notification request is answered with what the server says happened', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  // the server: when a request appears, answer it
  const server = db.firebaseFor('devA').database();
  server.ref('v3/pushTest/devA/request').on('value', (snap) => {
    if (snap.val()) setTimeout(() => server.ref('v3/pushTest/devA/result').set({ at: 1700000000000, devices: 2, sent: 1, failed: ['Apple (production): BadDeviceToken'] }), 10);
  });
  const r = await A.testPush();
  assert.deepStrictEqual(r, { devices: 2, sent: 1, failed: ['Apple (production): BadDeviceToken'] });
});

test('nobody answering is reported as no answer, not as success', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 20000 ? 30 : ms, ...rest); // do not wait twenty seconds
  try {
    assert.strictEqual(await A.testPush(), null);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

test('only the account itself can ask for, or read, its test', async () => {
  const db = new RulesDb();
  const evil = db.firebaseFor('devEvil').database();
  await assert.rejects(evil.ref('v3/pushTest/devA/request').set({ at: 1 }));
  await assert.rejects(evil.ref('v3/pushTest/devA/result').get());
  await evil.ref('v3/pushTest/devEvil/request').set({ at: 1 });
});

test('Settings offers the test, the server function answers it, and chat and turns also notify the window in front', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  assert.match(ui, /notif-test/);
  assert.match(ui, /C\.testPush\(\)/);
  assert.match(ui, /notify\(`\$\{msg\.name\}: \$\{msg\.text\}`/, 'a chat message');
  assert.match(ui, /notify\(`Your turn in “\$\{config\.name \|\| 'your game'\}”`/, 'my turn in the game on screen');
  const fn = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert.match(fn, /exports\.pushTest = onValueWritten/);
  assert.match(fn, /exports\.chatMessage = onValueCreated/);
});

test('Apple\'s refusals are explained in plain words with the raw reason kept', () => {
  const L = require('../src/lobby.js');
  const env = L.explainPushFailure('Apple (production): BadEnvironmentKeyInToken');
  assert.match(env, /Sandbox & Production/);
  assert.match(env, /APNS_KEY/);
  assert.match(env, /BadEnvironmentKeyInToken/, 'the raw answer stays visible');
  assert.match(L.explainPushFailure('Apple (production): InvalidProviderToken'), /APNS_KEY_ID/);
  assert.match(L.explainPushFailure('Apple (sandbox): BadDeviceToken'), /TestFlight/);
  assert.match(L.explainPushFailure('Apple (production): TopicDisallowed'), /com\.lyndasrummitummi\.ios/);
  assert.match(L.explainPushFailure('Android: messaging/internal-error'), /Android/);
  assert.strictEqual(L.explainPushFailure(''), 'unknown reason');
  assert.strictEqual(L.explainPushFailure('Something else'), 'Something else');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  assert.match(ui, /r\.failed\.map\(L\.explainPushFailure\)/, 'Settings shows the explanation');
});
