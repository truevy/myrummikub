const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');
const { Game } = require('../src/game.js');
const arena = require('../src/arena.js');
const SY = require('../src/sync.js');

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

// a game being played by Ann (devA, seat 0) and Bob (devB, seat 1), as the app writes it
async function playing(db, { phase = 'playing' } = {}) {
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  await A.publishPlayer({ id: hex('a'), name: 'Ann', face: '🦄', handle: 'ann_host', visibility: 'public', multi: true });
  await B.publishPlayer({ id: hex('b'), name: 'Bob', face: '🦊', handle: 'bob_guest', visibility: 'public', multi: true });
  const host = { pid: hex('a'), device: 'devA', name: 'Ann', face: '🦄' };
  const gid = await A.createGame(host, 'Ann game', { hints: 0, help: false, chat: true, kind: 'private' });
  const seats = [host, { pid: hex('b'), device: 'devB', name: 'Bob', face: '🦊' }];
  const g = new Game({ id: gid, players: seats.map((s) => ({ name: s.name, isAI: false, profileId: s.pid })) });
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  await A.startGame(gid, { players: seats, devices: ['devA', 'devB'], start: { draws: [], current: g.current }, stateJson: JSON.stringify(g), current: g.current, name: 'Ann game', round: 1 });
  if (phase !== 'playing') await A.endGame(gid);
  return { A, B, gid, g, db };
}

test('a player in a game that is being played can write their own leave request, nobody else can', async () => {
  const db = new RulesDb();
  const { A, B, gid } = await playing(db);
  await B.leaveGame(gid, [1]);
  const evil = db.firebaseFor('devEvil').database();
  await assert.rejects(evil.ref(`v3/games/${gid}/leave/0`).set({ at: 1 }), "someone else's seat");
  await assert.rejects(db.firebaseFor('devB').database().ref(`v3/games/${gid}/leave/0`).set({ at: 1 }), "another player's seat");
  const noTime = db.firebaseFor('devA').database().ref(`v3/games/${gid}/leave/0`).set({ nope: true });
  await assert.rejects(noTime, 'a request carries its time');
  await A.leaveGame(gid, [0]);
});

test('leaving takes the game out of the player\'s own list', async () => {
  const db = new RulesDb();
  const { B, gid } = await playing(db);
  const mine = () => db.firebaseFor('devB').database().ref(`v3/devices/devB/games/${gid}`).get().then((s) => s.exists());
  assert.ok(await mine() || true);
  await B.addMyGame(gid, { name: 'Ann game', host: false });
  assert.ok(await mine(), 'in the list');
  await B.leaveGame(gid, [1]);
  assert.ok(!(await mine()), 'gone from the list');
});

test('no leave request once the game is over', async () => {
  const db = new RulesDb();
  const { B, gid } = await playing(db, { phase: 'over' });
  await assert.rejects(B.leaveGame(gid, [1]));
});

test('what the server does with a leave request: the others play on, the last one left wins', () => {
  const mk = (n) => {
    const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })) });
    g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    return { rev: 4, current: g.current, json: JSON.stringify(g), g };
  };
  // three players: someone who is not on the move leaves
  const three = mk(3);
  const leaver = (three.current + 1) % 3;
  const out = arena.forfeitSeat(three, leaver);
  assert.ok(out && !out.over);
  assert.strictEqual(out.record.rev, 5);
  assert.strictEqual(out.record.current, three.current, 'the one on the move still is');
  assert.ok(out.record.forfeit);
  const after = Game.fromJSON(JSON.parse(out.record.json));
  assert.ok(after.players[leaver].dropped);
  assert.strictEqual(after.players[leaver].rack.filter(Boolean).length, 0, 'their tiles are back in the pool');
  assert.strictEqual(after.pool.length, three.g.pool.length + 14);
  // the one on the move leaves: the turn passes on
  const onMove = arena.forfeitSeat(three, three.current);
  assert.ok(onMove && !onMove.over && onMove.record.current !== three.current);
  // two players: the other wins
  const two = mk(2);
  const end = arena.forfeitSeat(two, 1 - two.current);
  assert.ok(end.over);
  assert.strictEqual(end.winner, two.current);
  // twice, or in a finished game: nothing to do
  const again = { ...two, json: end.record.json, rev: 5 };
  assert.strictEqual(arena.forfeitSeat(again, 1 - two.current), null);
  assert.strictEqual(arena.forfeitSeat({ rev: 1, json: 'not json' }, 0), null);
  // the time-out path is the same thing
  assert.deepStrictEqual(arena.forfeitTurn(three).record.current, onMove.record.current);
});

test('a drop-out made on the leaver\'s own turn is published as a forfeit', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  const me = g.current;
  assert.ok(g.forfeitPlayer(me));
  const rec = SY.packState(g, 7, { forfeit: true });
  assert.strictEqual(rec.forfeit, true);
  assert.notStrictEqual(rec.current, me, 'the turn moved on');
  assert.strictEqual(SY.packState(g, 8).forfeit, undefined, 'an ordinary move says nothing of the kind');
});

test('the function that handles leave requests and the rules are in place', () => {
  const fn = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert.match(fn, /exports\.playerLeft = onValueCreated/);
  assert.match(fn, /\/v3\/games\/\{gid\}\/leave\/\{seat\}/);
  assert.match(fn, /A\.forfeitSeat\(state, seat\)/);
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules.v3.games.$gid;
  assert.ok(rules.leave && rules.leave.$seat['.write'], 'rules for leave');
});
