const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');

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
const publish = (C, pid, name, handle, visibility = 'public') => C.publishPlayer({ id: pid, name, face: '🦄', handle, visibility, multi: true });

test('public players are listed for everyone, private players are not', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  const C = device(db, 'devC');
  await publish(A, hex('a'), 'Ann', 'ann_host');
  await publish(B, hex('b'), 'Bob', 'bob_guest', 'private');
  await publish(C, hex('c'), 'Cy', 'cy_pub');

  const seen = await A.listDirectory();
  assert.deepStrictEqual(seen.entries.map((e) => e.handle).sort(), ['ann_host', 'cy_pub']);
  assert.ok(seen.entries.every((e) => e.pid && e.name && e.face && e.at > 0));
  assert.strictEqual(seen.more, false);

  // the private player can still be found by typing the exact handle
  await B.claimHandle('bob_guest', hex('b'));
  assert.strictEqual((await A.lookupHandle('bob_guest')).pid, hex('b'));
});

test('going private takes a player off the list, going public puts them back, deleting removes them', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  await publish(A, hex('a'), 'Ann', 'ann_host');
  assert.strictEqual((await B.listDirectory()).entries.length, 1);
  await publish(A, hex('a'), 'Ann', 'ann_host', 'private');
  assert.strictEqual((await B.listDirectory()).entries.length, 0);
  await publish(A, hex('a'), 'Ann', 'ann_new', 'public');
  assert.deepStrictEqual((await B.listDirectory()).entries.map((e) => e.handle), ['ann_new']);
  await A.removePlayer(hex('a'));
  assert.strictEqual((await B.listDirectory()).entries.length, 0);
});

test('nobody can list someone else, or write over their entry, or read without signing in', async () => {
  const db = new RulesDb();
  const A = device(db, 'devA');
  await publish(A, hex('a'), 'Ann', 'ann_host');
  const evil = db.firebaseFor('devEvil').database();
  const ref = (p) => evil.ref(p);
  await assert.rejects(ref(`v3/directory/${hex('b')}`).set({ device: 'devEvil', handle: 'ghost_one', name: 'Ghost', face: '👻', at: 1 }), 'a listing for a player that is not theirs');
  await assert.rejects(ref(`v3/directory/${hex('a')}`).set({ device: 'devEvil', handle: 'ann_host', name: 'Ann', face: '🦄', at: 1 }), "someone else's listing");
  await assert.rejects(ref(`v3/directory/${hex('a')}`).remove(), "someone else's listing");
  // a listing whose handle is not the player's own
  const B = device(db, 'devB');
  await B.publishPlayer({ id: hex('b'), name: 'Bob', face: '🦊', handle: 'bob_guest', visibility: 'public' });
  await assert.rejects(db.firebaseFor('devB').database().ref(`v3/directory/${hex('b')}`).set({ device: 'devB', handle: 'someone_else', name: 'Bob', face: '🦊', at: 1 }));
  const entries = (await A.listDirectory()).entries;
  assert.deepStrictEqual(entries.map((e) => e.handle).sort(), ['ann_host', 'bob_guest']);
});

test('the list is tidied: newest first, nobody twice, never yourself, searchable', () => {
  const pids = { z: 'e', a: 'a', b: 'b' };
  const raw = (h, at) => lobby.cleanDirectoryEntry({ handle: h, name: h.toUpperCase().slice(0, 12), face: '🙂', at }, hex(pids[h[0]]));
  const list = [raw('zed_1', 10), raw('amy_2', 30), raw('bob_3', 20), raw('amy_2', 30), null, lobby.cleanDirectoryEntry({ handle: 'no', name: 'x' }, hex('d'))];
  assert.deepStrictEqual(lobby.directoryList(list).map((e) => e.handle), ['amy_2', 'bob_3', 'zed_1']);
  assert.deepStrictEqual(lobby.directoryList(list, { exclude: [hex('a')] }).map((e) => e.handle), ['bob_3', 'zed_1']);
  assert.deepStrictEqual(lobby.directoryList(list, { query: '@BO' }).map((e) => e.handle), ['bob_3']);
  assert.deepStrictEqual(lobby.directoryList(list, { query: 'amy' }).map((e) => e.handle), ['amy_2']);
  assert.strictEqual(lobby.cleanDirectoryEntry({ handle: 'Bad Handle', name: 'x' }, hex('a')), null);
  assert.strictEqual(lobby.cleanDirectoryEntry({ handle: 'fine_one' }, 'not-an-id'), null);
});

test('when a player was last around reads as a short phrase', () => {
  const now = 10 * 24 * 3600 * 1000;
  assert.strictEqual(lobby.lastActiveText(now - 60 * 1000, now), 'Active now');
  assert.strictEqual(lobby.lastActiveText(now - 12 * 60 * 1000, now), '12 min ago');
  assert.strictEqual(lobby.lastActiveText(now - 3 * 3600 * 1000, now), '3 h ago');
  assert.strictEqual(lobby.lastActiveText(now - 72 * 3600 * 1000, now), '3 days ago');
  assert.strictEqual(lobby.lastActiveText(0, now), '');
});
