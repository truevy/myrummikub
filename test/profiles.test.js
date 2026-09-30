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
  const sara = P.saveProfile(db, { name: '  Sara  ', face: '🦄', handle: '+1 (555) 010-2030' });
  assert.strictEqual(sara.name, 'Sara');
  assert.strictEqual(sara.handle, '+15550102030');
  assert.match(sara.id, /^[0-9a-f]{32}$/);
  assert.strictEqual(P.findByName(db, 'sara'), sara);
  assert.throws(() => P.saveProfile(db, { name: 'SARA' }), /already registered/);
  assert.throws(() => P.saveProfile(db, { name: '' }), /enter a name/);
  assert.throws(() => P.saveProfile(db, { name: 'Bo', handle: 'not a contact' }), /phone number or an email/);
  assert.throws(() => P.saveProfile(db, { name: 'Bo', photo: 'javascript:alert(1)' }), /photo/);
  // renaming keeps the id, so statistics follow the person
  P.saveProfile(db, { id: sara.id, name: 'Sara B', face: '🦄', handle: 'Sara@Example.com' });
  assert.strictEqual(db.profiles.length, 1);
  assert.strictEqual(db.profiles[0].handle, 'sara@example.com');
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
      { id: 'abcdef0123456789', name: 'Ann', face: '🐸', photo: 'data:text/html;base64,AAAA', handle: 'nope' },
      { id: 'abcdef0123456789aa', name: 'ann' },
      { id: 'not an id', name: 'Bob' },
      null,
    ],
    games: [{ id: 'zz' }, { id: 'abcdef0123456780', players: [{ name: 'Ann', place: 9 }] }],
    lastPlayers: ['Ann', 42],
  });
  assert.strictEqual(db.profiles.length, 1);
  assert.strictEqual(db.profiles[0].photo, null);
  assert.strictEqual(db.profiles[0].handle, '');
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
