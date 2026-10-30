const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');
const { Game } = require('../src/game.js');
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

test('a table has up to four players, up to two of them computers', () => {
  const human = (n, extra = {}) => ({ pid: hex(String(n)), device: 'dev' + n, name: 'P' + n, face: '🙂', token: null, status: 'ready', at: 0, ...extra });
  const bot = (n) => ({ ...lobby.computerPerson({ pid: hex('abcdef'[n]), device: 'dev1', name: 'Bot' + n, level: 4 }), token: null, status: 'ready', at: 0 });
  assert.strictEqual(lobby.MAX_PLAYERS, 4);
  assert.strictEqual(lobby.MAX_COMPUTERS, 2);
  // host, two guests and a computer
  assert.ok(lobby.canStart({ 0: human(1), 1: human(2), 2: human(3), 3: bot(0) }));
  // host and one computer is a game
  assert.ok(lobby.canStart({ 0: human(1), 1: bot(0) }));
  // two computers at most
  assert.ok(lobby.canStart({ 0: human(1), 1: bot(0), 2: bot(1) }));
  assert.ok(!lobby.canStart({ 0: human(1), 1: bot(0), 2: bot(1), 3: bot(2) }), 'three computers are too many');
  // adding: until there are two, and while there is a seat
  assert.ok(lobby.canAddComputer({ 0: human(1) }));
  assert.ok(lobby.canAddComputer({ 0: human(1), 1: bot(0) }));
  assert.ok(!lobby.canAddComputer({ 0: human(1), 1: bot(0), 2: bot(1) }), 'two is the most');
  assert.ok(!lobby.canAddComputer({ 0: human(1), 1: human(2), 2: human(3), 3: human(4) }), 'no seat');
  assert.ok(!lobby.canAddComputer({ 0: human(1), 1: human(2) }, [{ seat: '2', createdAt: 0 }, { seat: '3', createdAt: 0 }]), 'invitations keep their seats');
  // a seat read back from the database remembers it is a computer, at its level
  const read = lobby.cleanSeat({ ...bot(0) });
  assert.ok(read.ai);
  assert.strictEqual(read.level, 4);
  assert.strictEqual(lobby.cleanPerson({ pid: hex('a'), device: 'd', name: 'N', face: 'F', ai: true, level: 99 }).level, 3, 'a silly level becomes the middle one');
  assert.strictEqual(lobby.cleanPerson({ pid: hex('a'), device: 'd', name: 'N', face: 'F' }).ai, undefined, 'people are not computers');
});

// Ann (devA, host) with one guest, Bob (devB), and one computer played by Ann's computer
async function table() {
  const db = new RulesDb();
  const A = device(db, 'devA');
  const B = device(db, 'devB');
  await A.publishPlayer({ id: hex('a'), name: 'Ann', face: '🦄', handle: 'ann_host', visibility: 'public', multi: true });
  await B.publishPlayer({ id: hex('b'), name: 'Bob', face: '🦊', handle: 'bob_guest', visibility: 'public', multi: true });
  const host = { pid: hex('a'), device: 'devA', name: 'Ann', face: '🦄' };
  const gid = await A.createGame(host, 'Ann game', { hints: 0, help: false, chat: true, kind: 'private' });
  const bot = lobby.computerPerson({ pid: hex('c'), device: 'devA', name: 'Robo', level: 5 });
  const seats = [host, { pid: hex('b'), device: 'devB', name: 'Bob', face: '🦊' }, bot];
  const g = new Game({ id: gid, players: seats.map((s) => (s.ai ? { name: s.name, isAI: true, level: s.level } : { name: s.name, isAI: false, profileId: s.pid })) });
  g.pickFirstPlayer();
  g.deal();
  g.current = 2; // the computer is up
  g.beginTurn();
  return { db, A, B, gid, g, seats, host, bot };
}

test('the host can seat computers; nobody else can, and a computer must belong to the host\'s computer', async () => {
  const { db, A, gid, seats, g } = await table();
  for (let i = 0; i < seats.length; i++) await A.setSeat(gid, i, { ...seats[i], token: null, status: 'ready' });
  await A.startGame(gid, { players: seats, devices: ['devA', 'devB'], start: { draws: [], current: g.current }, stateJson: JSON.stringify(g), current: g.current, name: 'Ann game' });
  const meta = await A.readMeta(gid);
  assert.strictEqual(meta.players.length, 3);
  assert.deepStrictEqual(meta.players.map((p) => !!p.ai), [false, false, true]);
  assert.strictEqual(meta.players[2].level, 5);
  // a computer that claims to be played by someone else's computer is refused
  const forged = db.firebaseFor('devA').database().ref(`v3/games/${gid}/meta/players/2`);
  await assert.rejects(forged.set({ pid: hex('c'), device: 'devB', name: 'Robo', face: '🤖', ai: true, level: 3 }));
  await assert.rejects(forged.set({ pid: hex('c'), device: 'devA', name: 'Robo', face: '🤖', ai: true, level: 9 }), 'a level from 1 to 5');
  // a person who is not registered is still refused
  await assert.rejects(forged.set({ pid: hex('d'), device: 'devA', name: 'Fake', face: '🙂' }));
});

test('the host\'s computer publishes the computer\'s moves; a guest can only skip it when the host is away', async () => {
  const { db, A, B, gid, seats, g } = await table();
  await A.startGame(gid, { players: seats, devices: ['devA', 'devB'], start: { draws: [], current: 2 }, stateJson: JSON.stringify(g), current: 2, name: 'Ann game' });
  // the host plays the computer's move: rev 1, published by the host's computer
  g.drawAndPass();
  g.nextTurn();
  await A.publishState(gid, SY.packState(g, 1));
  assert.strictEqual((await A.readState(gid)).rev, 1);
  // a guest may not play for the computer
  const stranger = db.firebaseFor('devB').database().ref(`v3/games/${gid}/state`);
  const fake = { rev: 2, by: 'devB', current: 0, skipped: false, json: JSON.stringify(g) };
  await assert.rejects(stranger.set(fake), 'only the host\'s computer moves for the computer');
  // back to the computer's turn, with the host online: a guest cannot skip it either
  const h = Game.fromJSON(JSON.parse((await A.readState(gid)).json));
  h.current = 2;
  h.beginTurn();
  await A.publishState(gid, SY.packState(h, 2)); // (the host moves for the computer again)
  await A.setPresence([hex('a')], gid);
  const skip = { rev: 3, by: 'devB', current: 0, skipped: true, json: JSON.stringify(h) };
  await assert.rejects(db.firebaseFor('devB').database().ref(`v3/games/${gid}/state`).set(skip), 'the host is online');
  // the host goes away: now the table is not stuck
  await A.clearPresence();
  await B.publishState(gid, SY.packState(h, 3, { skipped: true }));
  assert.strictEqual((await B.readState(gid)).rev, 3);
});

test('the lobby and the game know about computers', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  assert.match(ui, /id="add-computer"/);
  assert.match(ui, /data-ai-seat=/);
  assert.match(ui, /s\.ai \? \{ name: s\.name, isAI: true, level: s\.level \}/, 'the game is dealt with its computers');
  assert.match(ui, /isAI: !!s\.ai, level: s\.level/, 'the table shows them');
  assert.match(ui, /if \(isOnline\(\)\) await publishTurn\(\);/, 'the host\'s computer tells the others what the computer did');
  assert.match(ui, /other\.isAI\) continue/, 'a computer is not added to friends or recent players');
});
