// The notification functions (functions/index.js) run here against a small fake database and fake
// Apple and Firebase push services, to see who would be told what.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const sent = { apns: [], fcm: [] };
let tree = {};

const getAt = (parts) => parts.reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), tree);
const setAt = (parts, value) => {
  if (!parts.length) return;
  let n = tree;
  parts.slice(0, -1).forEach((k) => (n = n[k] = n[k] && typeof n[k] === 'object' ? n[k] : {}));
  if (value === null || value === undefined) delete n[parts[parts.length - 1]];
  else n[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
};
const snap = (v) => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined && v !== null });
const refFor = (p) => {
  const parts = p.split('/').filter(Boolean);
  return {
    get: async () => snap(getAt(parts)),
    set: async (v) => setAt(parts, v),
    update: async (o) => Object.entries(o).forEach(([k, v]) => setAt(parts.concat(k.split('/')), v)),
    remove: async () => setAt(parts, null),
    transaction: async (fn) => {
      const cur = getAt(parts);
      const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
      if (next === undefined) return { committed: false, snapshot: snap(cur) };
      setAt(parts, next);
      return { committed: true, snapshot: snap(next) };
    },
    child: (c) => refFor(p + '/' + c),
  };
};

const stubs = {
  'firebase-functions/v2/database': { onValueWritten: (o, h) => h, onValueCreated: (o, h) => h, onValueDeleted: (o, h) => h },
  'firebase-functions/v2/scheduler': { onSchedule: (o, h) => h },
  'firebase-functions/params': { defineSecret: () => ({ value: () => 'secret' }), defineString: () => ({ value: () => 'value' }) },
  'firebase-admin/app': { initializeApp: () => {} },
  'firebase-admin/database': { getDatabase: () => ({ ref: refFor }), ServerValue: { TIMESTAMP: 0 } },
  'firebase-admin/messaging': { getMessaging: () => ({ send: async (m) => sent.fcm.push(m) }) },
  apns2: {
    ApnsClient: class {
      send(note) {
        sent.apns.push(note);
        return Promise.resolve();
      }
    },
    Notification: class {
      constructor(token, opts) {
        Object.assign(this, { token }, opts);
      }
    },
    Errors: { badDeviceToken: 'BadDeviceToken', unregistered: 'Unregistered', deviceTokenNotForTopic: 'DeviceTokenNotForTopic' },
  },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs[request]) return stubs[request];
  return load.call(this, request, parent, isMain);
};
const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));
Module._load = load;

const GID = 'g'.repeat(32);
const hex = (c) => c.repeat(16);
function table({ chat = true } = {}) {
  sent.apns.length = 0;
  sent.fcm.length = 0;
  const players = [
    { pid: hex('a'), device: 'devA', name: 'Ann', face: '🦄' },
    { pid: hex('b'), device: 'devB', name: 'Bob', face: '🦊' },
    { pid: hex('c'), device: 'devC', name: 'Cy', face: '🐻' },
  ];
  tree = {
    v3: {
      games: { [GID]: { meta: { host: hex('a'), hostDevice: 'devA', name: 'Ann game', phase: 'playing', players, devices: { devA: true, devB: true, devC: true }, options: { hints: 0, help: false, chat, kind: 'private' } } } },
      devices: { devA: { games: { [GID]: true } }, devB: { games: { [GID]: true } }, devC: { games: { [GID]: true } } },
      pushTokens: {
        devA: { aaaa: { env: 'production', device: 'i1' } },
        devB: { bbbb: { env: 'production', device: 'i2' }, eeee: { env: 'fcm', device: 'a1' } },
        devC: { cccc: { env: 'sandbox', device: 'i3' } },
      },
      presence: {},
    },
  };
}
const chatEvent = (msg, id = 'm1') => ({ data: { val: () => msg }, params: { gid: GID, id } });

test('a chat message notifies the other players\' devices, never the sender', async () => {
  table();
  await fns.chatMessage(chatEvent({ device: 'devA', pid: hex('a'), name: 'Ann', text: 'Your move, slowpoke', at: 1 }));
  const tokens = sent.apns.map((n) => n.token).sort();
  assert.deepStrictEqual(tokens, ['bbbb', 'cccc'], 'Bob\'s and Cy\'s iPhones; Ann sent it');
  assert.strictEqual(sent.fcm.length, 1, 'Bob\'s Android phone too');
  assert.strictEqual(sent.fcm[0].token, 'eeee');
  const note = sent.apns[0];
  assert.match(note.alert.title, /Ann in “Ann game”/);
  assert.strictEqual(note.alert.body, 'Your move, slowpoke');
  assert.strictEqual(note.data.gid, GID, 'a tap opens the game');
  assert.strictEqual(sent.fcm[0].data.gid, GID);
});

test('no chat notification for someone looking at the game, a table without chat, or a game that is over', async () => {
  table();
  tree.v3.presence[hex('b')] = { online: true, game: GID };
  await fns.chatMessage(chatEvent({ device: 'devA', name: 'Ann', text: 'hi', at: 1 }));
  assert.ok(!sent.apns.some((n) => n.token === 'bbbb') && sent.fcm.length === 0, 'Bob has the game open');
  assert.ok(sent.apns.some((n) => n.token === 'cccc'), 'Cy does not');
  table({ chat: false });
  await fns.chatMessage(chatEvent({ device: 'devA', name: 'Ann', text: 'hi', at: 1 }));
  assert.strictEqual(sent.apns.length + sent.fcm.length, 0, 'no chat at this table');
  table();
  tree.v3.games[GID].meta.phase = 'over';
  await fns.chatMessage(chatEvent({ device: 'devA', name: 'Ann', text: 'hi', at: 1 }));
  assert.strictEqual(sent.apns.length + sent.fcm.length, 0);
});

test('a flood of chat messages does not become a flood of notifications', async () => {
  table();
  for (let i = 0; i < 12; i++) await fns.chatMessage(chatEvent({ device: 'devA', name: 'Ann', text: 'spam ' + i, at: i }, 'm' + i));
  const toCy = sent.apns.filter((n) => n.token === 'cccc').length;
  assert.strictEqual(toCy, 6, 'six a minute at most');
});

test('a device that did not take part in the game hears nothing', async () => {
  table();
  delete tree.v3.devices.devC.games[GID];
  await fns.chatMessage(chatEvent({ device: 'devA', name: 'Ann', text: 'hi', at: 1 }));
  assert.ok(!sent.apns.some((n) => n.token === 'cccc'));
});

test('"your turn" goes to the player whose turn it now is, on every kind of device', async () => {
  table();
  const game = { over: false, current: 1, history: [] };
  const state = (rev, current, by) => ({ rev, current, by, json: JSON.stringify({ ...game, current }) });
  tree.v3.games[GID].state = state(1, 1, 'devA');
  await fns.yourTurn({ params: { gid: GID }, data: { before: { val: () => state(0, 0, 'devB') }, after: { val: () => state(1, 1, 'devA') } } });
  const to = sent.apns.map((n) => n.token).sort();
  assert.deepStrictEqual(to, ['bbbb'], 'Bob\'s iPhone');
  assert.deepStrictEqual(sent.fcm.map((m) => m.token), ['eeee'], 'and his Android phone');
  assert.match(sent.apns[0].alert.title, /Your turn in “Ann game”/);
  // the player who moved is not told about their own move
  sent.apns.length = 0;
  sent.fcm.length = 0;
  await fns.yourTurn({ params: { gid: GID }, data: { before: { val: () => state(1, 1, 'devA') }, after: { val: () => state(2, 1, 'devB') } } });
  assert.strictEqual(sent.apns.length + sent.fcm.length, 0, 'the same account moved: it knows');
});
