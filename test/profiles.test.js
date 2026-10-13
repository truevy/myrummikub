const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/profiles.js');
const { Game } = require('../src/game.js');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function finishedGame(seed, players) {
  const g = new Game({ players }, seeded(seed));
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  let turns = 0;
  while (!g.over && turns++ < 3000) {
    g.playAI();
    g.nextTurn();
  }
  assert.ok(g.over);
  return g;
}

test('profiles are registered by name, once', () => {
  const db = P.emptyDb();
  const sara = P.saveProfile(db, { name: '  Sara  ', face: '🦄', imHandle: '+1 (555) 010-2030' });
  assert.strictEqual(sara.name, 'Sara');
  assert.strictEqual(sara.imHandle, '+15550102030');
  assert.match(sara.id, /^[0-9a-f]{32}$/);
  assert.strictEqual(P.findByName(db, 'sara'), sara);
  assert.throws(() => P.saveProfile(db, { name: 'SARA' }), /already registered/);
  assert.throws(() => P.saveProfile(db, { name: '' }), /enter a name/);
  assert.throws(() => P.saveProfile(db, { name: 'Bo', imHandle: 'not a contact' }), /phone number or an email/);
  assert.throws(() => P.saveProfile(db, { name: 'Bo', photo: 'javascript:alert(1)' }), /photo/);
  // renaming keeps the id, so statistics follow the person
  P.saveProfile(db, { id: sara.id, name: 'Sara B', face: '🦄', imHandle: 'Sara@Example.com' });
  assert.strictEqual(db.profiles.length, 1);
  assert.strictEqual(db.profiles[0].imHandle, 'sara@example.com');
  assert.deepStrictEqual(P.invitable(db).map((p) => p.name), ['Sara B']);
});

test('statistics come from the ledger and a game is only counted once', () => {
  const db = P.emptyDb();
  const sara = P.saveProfile(db, { name: 'Sara' });
  const max = P.saveProfile(db, { name: 'Max' });
  // computer brains stand in for the two people so the games can be played out
  const g = finishedGame(4, [
    { name: 'Sara', isAI: true, level: 5 },
    { name: 'Max', isAI: true, level: 1 },
  ]);
  g.players[0].profileId = sara.id;
  g.players[1].profileId = max.id;
  assert.ok(P.recordGame(db, g, 1000));
  assert.ok(!P.recordGame(db, g, 2000), 'same game id is ignored');
  assert.strictEqual(db.games.length, 1);

  const winner = g.players[g.result.winner].profileId;
  const loser = winner === sara.id ? max.id : sara.id;
  assert.deepStrictEqual([P.statsFor(db, winner).wins, P.statsFor(db, loser).wins], [1, 0]);
  const s = P.statsFor(db, sara.id);
  const mine = g.history.filter((h) => h.player === 0 && h.type === 'play');
  assert.strictEqual(s.games, 1);
  assert.strictEqual(s.bestMove, Math.max(...mine.map((h) => h.count)));
  assert.strictEqual(s.tiles, mine.reduce((n, h) => n + h.count, 0));
  assert.strictEqual(s.lastPlayed, 1000);

  // merging a copy of the ledger from "another computer" changes nothing
  const merged = P.cleanDb({ profiles: db.profiles, games: db.games.concat(JSON.parse(JSON.stringify(db.games))) });
  assert.strictEqual(merged.games.length, 1);
  assert.deepStrictEqual(P.statsFor(merged, sara.id), s);
});

test('a damaged profiles file is cleaned, not trusted', () => {
  const db = P.cleanDb({
    profiles: [
      { id: 'abcdef0123456789', name: 'Ann', face: '🐸', photo: 'data:text/html;base64,AAAA', imHandle: 'nope' },
      { id: 'abcdef0123456789aa', name: 'ann' },
      { id: 'not an id', name: 'Bob' },
      null,
    ],
    games: [{ id: 'zz' }, { id: 'abcdef0123456780', players: [{ name: 'Ann', place: 9 }] }],
    lastPlayers: ['Ann', 42],
  });
  assert.strictEqual(db.profiles.length, 1);
  assert.strictEqual(db.profiles[0].photo, null);
  assert.strictEqual(db.profiles[0].imHandle, '');
  assert.strictEqual(db.games.length, 1);
  assert.strictEqual(db.games[0].players[0].place, 1);
  assert.deepStrictEqual(db.lastPlayers, ['Ann']);
  assert.deepStrictEqual(P.cleanDb('garbage'), P.emptyDb());
});

test('a game remembers who sat where through save and load', () => {
  const g = new Game({ players: [{ name: 'Sara', profileId: 'abcdef0123456789' }, { name: 'Bot', isAI: true, profileId: 'abcdef0123456789' }] }, seeded(2));
  assert.strictEqual(g.players[1].profileId, null, 'computers never carry a profile');
  g.deal();
  g.beginTurn();
  const copy = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.strictEqual(copy.id, g.id);
  assert.strictEqual(copy.players[0].profileId, 'abcdef0123456789');
});

test('players from another device are adopted, taking over a local player of the same name', () => {
  const db = P.emptyDb();
  const local = P.saveProfile(db, { name: 'Tina', face: '🦄' });
  db.games.push({ id: 'g1', endedAt: 1, reason: 'out', players: [{ profileId: local.id, name: 'Tina', isAI: false, level: 0, place: 1, bestMove: 5, tiles: 14 }] });
  const cloudId = 'c'.repeat(32);
  const adopted = P.adoptProfile(db, { id: cloudId, name: 'tina', face: '🦊', photo: null });
  assert.strictEqual(db.profiles.length, 1, 'no second Tina');
  assert.strictEqual(adopted.id, cloudId);
  assert.strictEqual(adopted.cloud, true);
  assert.strictEqual(P.statsFor(db, cloudId).wins, 1, 'her games came along');
  const max = P.adoptProfile(db, { id: 'd'.repeat(32), name: 'Max', face: '🐻', photo: 'not a photo' });
  assert.strictEqual(db.profiles.length, 2);
  assert.strictEqual(max.photo, null, 'a bad photo is dropped');
  P.adoptProfile(db, { id: 'd'.repeat(32), name: 'Maximus', face: '🐻' });
  assert.strictEqual(db.profiles.length, 2, 'adopting again updates');
  assert.strictEqual(P.findById(db, 'd'.repeat(32)).name, 'Maximus');
  const again = P.cleanDb(JSON.parse(JSON.stringify(db)));
  assert.strictEqual(again.profiles.length, 2, 'adopted players survive saving and loading');
});

test('online and offline games are counted apart', () => {
  const db = P.emptyDb();
  const tina = P.saveProfile(db, { name: 'Tina' });
  const row = (place, bestMove) => ({ profileId: tina.id, name: 'Tina', isAI: false, level: 0, place, bestMove, tiles: 14 });
  db.games.push({ id: 'a'.repeat(16), endedAt: 1, reason: 'out', players: [row(1, 5)] }); // from before games were marked: offline
  db.games.push({ id: 'b'.repeat(16), endedAt: 2, reason: 'out', online: false, players: [row(2, 9)] });
  db.games.push({ id: 'c'.repeat(16), endedAt: 3, reason: 'out', online: true, players: [row(1, 7)] });
  const again = P.cleanDb(JSON.parse(JSON.stringify(db)));
  const off = P.statsFor(again, tina.id, 'offline');
  const on = P.statsFor(again, tina.id, 'online');
  assert.deepStrictEqual([off.games, off.wins, off.bestMove], [2, 1, 9]);
  assert.deepStrictEqual([on.games, on.wins, on.bestMove], [1, 1, 7]);
  assert.strictEqual(P.statsFor(again, tina.id).games, 3, 'without a kind, everything counts');
});

test('names have to be friendly, without refusing innocent ones', () => {
  for (const ok of ['Tina', 'Scunthorpe', 'Dickens', 'Cocktail', 'Analyst', 'Assassin', 'Max', 'Mary Jo']) assert.ok(!P.isOffensive(ok), ok + ' is fine');
  for (const bad of ['shit', 'sh1t', 'S.h.i.t', 'Big Dick', 'F.U.C.K', 'fuckface', 'Ass']) assert.ok(P.isOffensive(bad), bad + ' is refused');
  assert.throws(() => P.saveProfile(P.emptyDb(), { name: 'sh1t' }), /friendlier/);
});

// ---- 3.0: online handles, listing and statistics by kind of game ----------------

test('an online handle is tidied, unique and not offensive', () => {
  const db = P.emptyDb();
  const a = P.saveProfile(db, { name: 'Ann', handle: ' @Ann_Plays ' });
  assert.strictEqual(a.handle, 'ann_plays');
  assert.strictEqual(a.visibility, 'public', 'public unless chosen otherwise');
  assert.strictEqual(a.multi, false);
  assert.throws(() => P.saveProfile(db, { name: 'Bob', handle: 'ANN_PLAYS' }), /already taken/);
  assert.throws(() => P.saveProfile(db, { name: 'Bob', handle: 'ab' }), /3 to 16/);
  assert.throws(() => P.saveProfile(db, { name: 'Bob', handle: 'has space' }), /3 to 16/);
  assert.throws(() => P.saveProfile(db, { name: 'Bob', handle: 'sh1t_' }), /friendlier/);
  assert.throws(() => P.saveProfile(db, { name: 'Bob', handle: 'admin' }), /friendlier/);
  assert.strictEqual(P.cleanUserHandle('x'.repeat(17)), '');
});

test('a handle can be changed once every 30 days', () => {
  const db = P.emptyDb();
  const day = 86400000;
  const a = P.saveProfile(db, { name: 'Ann', handle: 'first_one' }, 1000);
  assert.strictEqual(a.handleChangedAt, 0, 'choosing the first handle is not a change');
  P.saveProfile(db, { id: a.id, name: 'Ann', handle: 'second_one' }, 1000 + day);
  assert.strictEqual(db.profiles[0].handle, 'second_one');
  assert.throws(() => P.saveProfile(db, { id: a.id, name: 'Ann', handle: 'third_one' }, 1000 + 20 * day), /again in 11 days/);
  P.saveProfile(db, { id: a.id, name: 'Ann', handle: 'third_one' }, 1000 + 31 * day);
  assert.strictEqual(db.profiles[0].handle, 'third_one');
  // saving other things never touches the handle or its clock
  P.saveProfile(db, { id: a.id, name: 'Ann B', visibility: 'private', multi: true }, 1000 + 32 * day);
  assert.strictEqual(db.profiles[0].handle, 'third_one');
  assert.strictEqual(db.profiles[0].visibility, 'private');
  assert.strictEqual(db.profiles[0].multi, true);
});

test('registering as me survives a round trip, and deleting me clears it', () => {
  const db = P.emptyDb();
  const a = P.saveProfile(db, { name: 'Ann', handle: 'ann_1', gc: { id: 'G:123', alias: 'Annie' } });
  db.me = a.id;
  const again = P.cleanDb(JSON.parse(JSON.stringify(db)));
  assert.strictEqual(P.me(again).handle, 'ann_1');
  assert.deepStrictEqual(P.me(again).gc, { id: 'G:123', alias: 'Annie' });
  assert.strictEqual(P.cleanDb({ ...db, me: 'ffffffffffffffff' }).me, null, 'me must be a known profile');
  P.removeProfile(db, a.id);
  assert.strictEqual(db.me, null);
});

test('a version 1 ledger keeps its iMessage address and its games', () => {
  const old = {
    version: 1,
    profiles: [{ id: 'abcdef0123456789', name: 'Ann', handle: 'ann@example.com', cloud: true }],
    games: [
      { id: 'aaaaaaaa11111111', endedAt: 5, online: true, players: [{ profileId: 'abcdef0123456789', name: 'Ann', place: 1 }, { name: 'B', place: 2 }] },
      { id: 'bbbbbbbb11111111', endedAt: 6, players: [{ profileId: 'abcdef0123456789', name: 'Ann', place: 2 }, { name: 'Cy', isAI: true, place: 1 }] },
      { id: 'cccccccc11111111', endedAt: 7, players: [{ profileId: 'abcdef0123456789', name: 'Ann', place: 1 }, { name: 'Di', place: 2 }] },
    ],
  };
  const db = P.cleanDb(old);
  assert.strictEqual(db.profiles[0].imHandle, 'ann@example.com');
  assert.strictEqual(db.profiles[0].handle, '');
  assert.deepStrictEqual(db.games.map((g) => g.mode), ['multi', 'single', 'local']);
});

test('single player, same computer and multiplayer statistics are kept apart', () => {
  const db = P.emptyDb();
  const ann = P.saveProfile(db, { name: 'Ann' });
  const ben = P.saveProfile(db, { name: 'Ben' });
  const play = (seed, who, online) => {
    const g = finishedGame(seed, who.map((p) => ({ name: p.name, isAI: true, level: 3 })));
    who.forEach((p, i) => (g.players[i].profileId = p.id));
    P.recordGame(db, g, seed * 1000, online);
    return g;
  };
  play(2, [ann, ben]); // two people on one computer would be local, but these are computers
  db.games.forEach((g) => (g.mode = 'local'));
  const solo = play(3, [ann, { name: 'Zed', id: null }]);
  db.games[db.games.length - 1].mode = 'single';
  play(4, [ann, ben], true);
  assert.deepStrictEqual(db.games.map((g) => g.mode), ['local', 'single', 'multi']);
  assert.strictEqual(P.statsFor(db, ann.id, 'single').games, 1);
  assert.strictEqual(P.statsFor(db, ann.id, 'local').games, 1);
  assert.strictEqual(P.statsFor(db, ann.id, 'multi').games, 1);
  assert.strictEqual(P.statsFor(db, ann.id, 'online').games, 1);
  assert.strictEqual(P.statsFor(db, ann.id, 'offline').games, 2);
  assert.strictEqual(P.statsFor(db, ann.id).games, 3);
  assert.strictEqual(P.statsFor(db, ben.id, 'single').games, 0);
  assert.ok(solo.over);
});

test('the kind of game is worked out when a game is recorded', () => {
  const db = P.emptyDb();
  const two = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(1));
  const one = new Game({ players: [{ name: 'A' }, { name: 'Cpu', isAI: true }] }, seeded(1));
  const over = (g, id) => {
    g.id = id;
    g.over = true;
    g.history = [];
    g.result = { reason: 'out', ranking: [0, 1], scores: null };
    return g;
  };
  P.recordGame(db, over(two, 'aaaaaaaa00000001'), 1, false);
  P.recordGame(db, over(one, 'aaaaaaaa00000002'), 2, false);
  P.recordGame(db, over(new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(1)), 'aaaaaaaa00000003'), 3, true);
  assert.deepStrictEqual(db.games.map((g) => g.mode), ['local', 'single', 'multi']);
});
