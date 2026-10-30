const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');
const { Game } = require('../src/game.js');

const CLOUD_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'cloud.js'), 'utf8');
function device(db, uid) {
  const fb = db.firebaseFor(uid);
  const self = {
    RK: {
      lobby,
      newId: () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      CLOUD: { inviteTtlMs: 24 * 3600 * 1000, firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } },
    },
    firebase: fb,
  };
  new Function('self', CLOUD_SRC)(self);
  return self.RK.cloud;
}
const hex = (c) => c.repeat(16);

async function accountWithEverything(db) {
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  const ann = { id: hex('a'), name: 'Ann', face: '🦄', handle: 'ann_host', visibility: 'public', multi: true };
  const bob = { id: hex('b'), name: 'Bob', face: '🦊', handle: 'bob_guest', visibility: 'public', multi: true };
  await A.publishPlayer(ann);
  await A.claimHandle('ann_host', ann.id);
  await A.claimName('Ann', ann.id);
  await A.setPresence([ann.id], null);
  await B.publishPlayer(bob);
  await B.claimHandle('bob_guest', bob.id);
  await A.addFriend(ann.id, bob.id, { name: 'Bob', face: '🦊' });
  await A.addRecent(ann.id, { pid: bob.id, name: 'Bob', face: '🦊', handle: 'bob_guest' }, 'private');
  await A.savePushToken('tokentokentoken', 'production');
  // a game Ann hosts that is being played, and an open lobby of hers
  const host = { pid: ann.id, device: 'devA', name: 'Ann', face: '🦄' };
  const playing = await A.createGame(host, 'Playing', { hints: 0, help: false, chat: false, kind: 'private' });
  const seats = [host, { pid: bob.id, device: 'devB', name: 'Bob', face: '🦊' }];
  const g = new Game({ id: playing, players: seats.map((x) => ({ name: x.name, isAI: false, profileId: x.pid })) });
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  await A.startGame(playing, { players: seats, devices: ['devA', 'devB'], start: { draws: [], current: g.current }, stateJson: JSON.stringify(g), current: g.current, name: 'Playing' });
  await A.addMyGame(playing, { name: 'Playing', host: true });
  const lobbyGid = await A.createGame(host, 'Open lobby', { kind: 'private' });
  await A.addMyGame(lobbyGid, { name: 'Open lobby', host: true });
  return { A, B, ann, bob, playing, lobbyGid };
}

test('deleting the account removes everything the account has online', async () => {
  const db = new RulesDb();
  const { A, ann, bob, playing, lobbyGid } = await accountWithEverything(db);
  const before = JSON.stringify(db.tree.v3);
  assert.ok(before.includes('ann_host'));
  const result = await A.deleteAccount([ann]);
  assert.strictEqual(result.signInRemoved, true);
  const v3 = db.tree.v3;
  const has = (obj, key) => obj && Object.prototype.hasOwnProperty.call(obj, key);
  assert.ok(!has(v3.players, ann.id), 'the player');
  assert.ok(!has(v3.handles, 'ann_host'), 'the handle is free again');
  assert.ok(!has(v3.names, 'ann'), 'the name is free again');
  assert.ok(!has(v3.directory, ann.id), 'not in the list of players');
  assert.ok(!has(v3.presence, ann.id));
  assert.ok(!has(v3.friends, ann.id));
  assert.ok(!has(v3.recent, ann.id));
  assert.ok(!has(v3.pushTokens, 'devA'), 'no notifications');
  assert.ok(!has(v3.devices, 'devA'), 'no list of games');
  assert.ok(!has(v3.accounts, 'devA'));
  assert.ok(!has(v3.games, lobbyGid), 'an open lobby is deleted');
  // a game being played: the player drops out (a request the server carries out)
  assert.ok(has(v3.games, playing) && v3.games[playing].leave && v3.games[playing].leave[0], 'a leave request for her seat');
  // someone else is untouched
  assert.ok(has(v3.players, bob.id) && has(v3.handles, 'bob_guest'));
  // the sign-in is gone, so the next use starts afresh
  assert.strictEqual(A.deviceId(), null);
});

test('after deleting, the handle can be taken by someone else', async () => {
  const db = new RulesDb();
  const { A, ann } = await accountWithEverything(db);
  await A.deleteAccount([ann]);
  const C = device(db, 'devC');
  const cy = { id: hex('c'), name: 'Cy', face: '🐻', handle: 'ann_host', visibility: 'public', multi: true };
  await C.publishPlayer(cy);
  assert.strictEqual(await C.claimHandle('ann_host', cy.id), true);
});

test('a refused sign-in deletion does not stop the data from going', async () => {
  const db = new RulesDb();
  const { A, ann } = await accountWithEverything(db);
  const fb = db.firebaseFor('devA');
  // an account whose sign-in cannot be deleted without signing in again
  const auth = fb.auth();
  const real = fb.auth;
  fb.auth = () => ({ ...auth, currentUser: { uid: 'devA', delete: async () => { throw Object.assign(new Error('recent login'), { code: 'auth/requires-recent-login' }); } }, signOut: async () => {} });
  const A2 = (() => {
    const self = { RK: { lobby, newId: () => 'f'.repeat(32), CLOUD: { firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } } }, firebase: fb };
    new Function('self', CLOUD_SRC)(self);
    return self.RK.cloud;
  })();
  const result = await A2.deleteAccount([ann]);
  fb.auth = real;
  assert.strictEqual(result.signInRemoved, false);
  assert.ok(!db.tree.v3.players || !db.tree.v3.players[ann.id]);
});

test('the chat is off: nobody can post to a game\'s chat, and games say so', async () => {
  const db = new RulesDb();
  const { playing } = await accountWithEverything(db);
  await assert.rejects(db.firebaseFor('devA').database().ref(`v3/games/${playing}/chat/m1`).set({ device: 'devA', name: 'Ann', text: 'hi', at: 1 }));
  assert.strictEqual(lobby.CHAT_ENABLED, false);
  assert.strictEqual(lobby.cleanOptions({ chat: true, kind: 'private' }).chat, false);
});

test('the account can be deleted from the screens people use', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  assert.match(ui, /id="pf-delete-account"/, 'in the editor of one\'s own player');
  assert.match(ui, /id="delete-account"/, 'in the start screen\'s menu');
  assert.match(ui, /function confirmDeleteAccount/);
  assert.match(ui, /C\.deleteAccount\(mine\)/);
  assert.match(ui, /dataset\.sure !== 'yes'/, 'a second press confirms');
});
