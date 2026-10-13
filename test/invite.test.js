const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');

// Runs the app's own src/cloud.js for one device, against a database that applies
// the real rules in database.rules.json.
const CLOUD_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'cloud.js'), 'utf8');
function device(db, uid) {
  const self = {
    RK: {
      lobby,
      newId: () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      CLOUD: { inviteTtlMs: 24 * 3600 * 1000, firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } },
    },
    firebase: db.firebaseFor(uid),
  };
  new Function('self', CLOUD_SRC)(self);
  return self.RK.cloud;
}
const hex = (c) => c.repeat(16);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// what goOnline does for a registered player
async function register(C, uid, { pid, name, handle, visibility = 'public' }) {
  await C.publishPlayer({ id: pid, name, face: '🦄', handle, visibility, multi: true });
  assert.strictEqual(await C.claimHandle(handle, pid), true, `${handle} can be claimed`);
  await C.claimName(name, pid);
  await C.setPresence([pid], null);
}

test('two players register, one invites the other by handle, and the game starts', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  const pidA = hex('a');
  const pidB = hex('b');
  await register(A, 'devA', { pid: pidA, name: 'Ann', handle: 'ann_host' });
  await register(B, 'devB', { pid: pidB, name: 'Bob', handle: 'bob_guest' });

  // Bob is waiting for invitations, as the app does once he is online
  const inbox = [];
  B.watchInbox([pidB], (items) => inbox.push(items));

  // Ann opens a private game
  const host = { pid: pidA, device: 'devA', name: 'Ann', face: '🦄' };
  const gid = await A.createGame(host, 'Ann game', { hints: 3, help: true, chat: true, kind: 'private' });
  await A.setSeat(gid, 0, { ...host, token: null, status: 'ready' });
  const meta = await A.readMeta(gid);
  assert.deepStrictEqual(meta.options, { hints: 3, help: true, chat: true, kind: 'private' });

  // she types Bob's handle
  const found = await A.lookupHandle('bob_guest');
  assert.ok(found, 'the handle is found');
  assert.strictEqual(found.pid, pidB);
  assert.strictEqual(found.name, 'Bob');
  const token = await A.createInvite({ gid, seat: '1', from: host, toPid: found.pid });

  // Bob's app is told
  await tick();
  const last = inbox[inbox.length - 1];
  assert.ok(last && last.length === 1, 'the invitation reaches Bob\'s inbox');
  assert.strictEqual(last[0].token, token);
  assert.strictEqual(last[0].from.pid, pidA);
  assert.strictEqual(last[0].game, gid);

  // Bob accepts, as acceptInvite does
  const inv = await B.readInvite(token);
  assert.ok(inv && !inv.revoked && inv.game === gid && inv.seat === '1', 'Bob can read the invitation');
  await B.claimInvite(token, { pid: pidB, status: 'joining' });
  const bob = { pid: pidB, device: 'devB', name: 'Bob', face: '🦄' };
  await B.setSeat(inv.game, inv.seat, { ...bob, token, status: 'ready' });
  await B.addFriend(pidB, pidA, { name: 'Ann', face: '🦄' });
  await B.addRecent(pidB, { pid: pidA, name: 'Ann', face: '🦄', handle: 'ann_host' }, 'private');

  // Ann sees Bob at the table and starts
  const seats = [];
  A.watchSeats(gid, (s) => seats.push(s));
  await tick();
  assert.ok(seats.length && seats[seats.length - 1]['1'] && seats[seats.length - 1]['1'].status === 'ready', 'Ann sees Bob seated');
  await A.startGame(gid, { players: [{ ...host }, { ...bob }], devices: ['devA', 'devB'], start: { draws: [1, 2], current: 0 }, stateJson: '{"x":1}', current: 0, name: 'Ann game' });
  await A.addMyGame(gid, { name: 'Ann game', host: true });
  await A.addRecent(pidA, { pid: pidB, name: 'Bob', face: '🦄', handle: 'bob_guest' }, 'private');
  const after = await B.readMeta(gid);
  assert.strictEqual(after.phase, 'playing');
  assert.deepStrictEqual(after.devices.sort(), ['devA', 'devB']);

  assert.deepStrictEqual(db.denied, [], 'the rules refused nothing: ' + JSON.stringify(db.denied.map((d) => d.why)));
});

test('a private player is found by exact handle, and a handle nobody has is not found', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  await register(A, 'devA', { pid: hex('a'), name: 'Ann', handle: 'ann_host' });
  await register(B, 'devB', { pid: hex('b'), name: 'Bob', handle: 'bob_private', visibility: 'private' });
  const found = await A.lookupHandle('bob_private');
  assert.ok(found && found.pid === hex('b') && found.visibility === 'private');
  assert.strictEqual(await A.lookupHandle('nobody_here'), null);
  assert.strictEqual((await A.lookupHandle('Bob_Private')).pid, hex('b'), 'case does not matter');
  assert.deepStrictEqual(db.denied, []);
});

test('a handle can only be held by one player, and nobody can take it over', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  await register(A, 'devA', { pid: hex('a'), name: 'Ann', handle: 'taken_one' });
  await B.publishPlayer({ id: hex('b'), name: 'Bob', face: '🦄', handle: 'bob_x', visibility: 'public', multi: false });
  assert.strictEqual(await B.claimHandle('taken_one', hex('b')), false, 'Bob cannot claim Ann\'s handle');
  assert.strictEqual(await A.handleOwner('taken_one'), hex('a'));
});

test('a player cannot be invited into a game by someone who is not its host', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  const C = device(db, 'devC');
  await register(A, 'devA', { pid: hex('a'), name: 'Ann', handle: 'ann_host' });
  await register(B, 'devB', { pid: hex('b'), name: 'Bob', handle: 'bob_guest' });
  await register(C, 'devC', { pid: hex('c'), name: 'Cy', handle: 'cy_other' });
  const host = { pid: hex('a'), device: 'devA', name: 'Ann', face: '🦄' };
  const gid = await A.createGame(host, 'Ann game', null);
  await assert.rejects(() => C.createInvite({ gid, seat: '1', from: { pid: hex('c'), device: 'devC', name: 'Cy', face: '🦄' }, toPid: hex('b') }), /PERMISSION_DENIED|Permission denied/);
});
