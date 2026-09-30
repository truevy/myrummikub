const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/sync.js');
const { Game, RACK_COLS } = require('../src/game.js');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function dealt(seed) {
  const g = new Game({ players: [{ name: 'Tina', profileId: 'abcdef0123456789' }, { name: 'Sara', profileId: 'abcdef0123456780' }] }, seeded(seed));
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  return g;
}

test('a published state rebuilds the same game on another computer', () => {
  const g = dealt(7);
  // a few turns played by the solver stand in for people
  for (let i = 0; i < 6; i++) {
    g.playAI();
    g.nextTurn();
  }
  const rec = S.packState(g, 6);
  assert.strictEqual(rec.rev, 6);
  assert.strictEqual(rec.current, g.current);
  assert.strictEqual(rec.skipped, false);
  const h = S.unpackState(rec);
  assert.strictEqual(JSON.stringify(h), rec.json, 'nothing lost on the way');
  assert.strictEqual(h.history.length, 6);
  assert.deepStrictEqual(S.lastActionOf(h), { player: g.history[5].player, type: g.history[5].type, count: g.history[5].count, place: 0 });
  assert.ok(S.acceptRev(5, 6));
  assert.ok(!S.acceptRev(6, 6));
  assert.ok(!S.acceptRev(6, 3));
  assert.ok(!S.acceptRev(6, '7'));
  assert.throws(() => S.unpackState({ json: '{"version":99}' }), /not a valid saved game/);
});

test('merging keeps the local rack layout and fixes up the tiles', () => {
  const t = (id) => ({ id, value: 1, color: 0, joker: false });
  const local = new Array(RACK_COLS * 2).fill(null);
  local[3] = t(10);
  local[7] = t(11);
  local[20] = t(12);
  // the table now knows tile 11 was played and tile 99 was drawn
  const remote = new Array(RACK_COLS * 2).fill(null);
  remote[0] = t(10);
  remote[1] = t(12);
  remote[2] = t(99);
  const merged = S.mergeRack(local, remote);
  assert.strictEqual(merged.length, RACK_COLS * 2);
  assert.strictEqual(merged[3].id, 10, 'stays where it was');
  assert.strictEqual(merged[20].id, 12, 'stays where it was');
  assert.strictEqual(merged[7], null, 'the played tile is gone');
  assert.strictEqual(merged[0].id, 99, 'the drawn tile takes the first free slot');

  // a full local rack grows by a row to take a new tile
  const full = Array.from({ length: RACK_COLS * 2 }, (_, i) => t(i));
  const bigger = S.mergeRack(full, full.concat([t(500)]));
  assert.strictEqual(bigger.length, RACK_COLS * 3);
  assert.strictEqual(bigger[RACK_COLS * 2].id, 500);
});

test('a skipped player drawing on their behalf keeps the game consistent', () => {
  const g = dealt(3);
  const absent = g.current;
  const before = g.rackTiles(g.players[absent]).length;
  g.drawAndPass(); // done by another computer while the mover is offline
  g.nextTurn();
  const rec = S.packState(g, 1, { skipped: true });
  const h = S.unpackState(rec);
  assert.ok(rec.skipped);
  assert.strictEqual(h.rackTiles(h.players[absent]).length, before + 1);
  assert.strictEqual(h.history[0].type, 'draw');
  assert.notStrictEqual(h.current, absent);
  assert.strictEqual(h.board.filter(Boolean).length + h.pool.length + h.players.reduce((n, p) => n + h.rackTiles(p).length, 0), 106);
});
