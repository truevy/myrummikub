const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/game.js');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function table(n, seed = 7) {
  const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })) }, seeded(seed));
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  return g;
}
const allIds = (g) => g.board.concat(g.pool, ...g.players.map((p) => p.rack)).filter(Boolean).map((t) => t.id).sort((a, b) => a - b);

test('a player who drops out gives their tiles back to the pool', () => {
  const g = table(3);
  const other = (g.current + 1) % 3;
  const before = g.pool.length;
  const mine = g.rackTiles(g.players[other]).length;
  assert.strictEqual(mine, 14);
  assert.ok(g.forfeitPlayer(other));
  assert.strictEqual(g.pool.length, before + 14);
  assert.strictEqual(g.rackTiles(g.players[other]).length, 0);
  assert.strictEqual(g.players[other].dropped, true);
  assert.strictEqual(allIds(g).length, 106, 'no tile is lost or doubled');
  assert.strictEqual(new Set(allIds(g)).size, 106);
  assert.ok(!g.over, 'two players are still left');
});

test('the others play on, skipping the one who dropped out', () => {
  const g = table(3);
  const gone = (g.current + 1) % 3;
  g.forfeitPlayer(gone);
  const seen = [];
  for (let i = 0; i < 6 && !g.over; i++) {
    seen.push(g.current);
    g.playAI();
    g.nextTurn();
  }
  assert.ok(!seen.includes(gone));
  assert.ok(seen.length >= 2);
});

test('if the player whose turn it is drops out, the turn passes on', () => {
  const g = table(3);
  const gone = g.current;
  g.forfeitPlayer(gone);
  assert.notStrictEqual(g.current, gone);
  assert.ok(!g.players[g.current].dropped);
  assert.ok(g.turn, 'the next player has a turn to play');
});

test('the last player left wins and the one who dropped ranks last', () => {
  const g = table(2);
  const gone = g.current;
  const stays = 1 - gone;
  assert.ok(g.forfeitPlayer(gone));
  assert.ok(g.over);
  assert.strictEqual(g.result.reason, 'forfeit');
  assert.strictEqual(g.result.winner, stays);
  assert.deepStrictEqual(g.result.ranking, [stays, gone]);
  assert.deepStrictEqual(g.scores, [0, 0], 'no points change hands');
});

test('in a game of four, three drop out one by one and the fourth wins', () => {
  const g = table(4);
  const stays = (g.current + 2) % 4;
  for (const i of [0, 1, 2, 3].filter((i) => i !== stays)) g.forfeitPlayer(i);
  assert.ok(g.over);
  assert.strictEqual(g.result.winner, stays);
  assert.strictEqual(g.result.ranking[0], stays);
  assert.strictEqual(g.players.filter((p) => p.dropped).length, 3);
});

test('a player cannot drop out twice, nor after the game ends', () => {
  const g = table(3);
  assert.ok(g.forfeitPlayer(0));
  assert.ok(!g.forfeitPlayer(0));
  assert.ok(!g.forfeitPlayer(9));
  g.forfeitPlayer(1);
  assert.ok(g.over);
  assert.ok(!g.forfeitPlayer(2));
});

test('a joker in a forfeited rack comes back to the pool as a plain joker', () => {
  const g = table(3);
  const who = (g.current + 1) % 3;
  const joker = g.jokers[0];
  // hand the joker, remembering a stale identity, to the player who will drop out
  const holder = g.players.find((p) => g.rackTiles(p).includes(joker));
  const inPool = g.pool.indexOf(joker);
  if (inPool >= 0) g.pool.splice(inPool, 1);
  else holder.rack[holder.rack.indexOf(joker)] = null;
  joker.rep = { value: 5, colors: [0] };
  g.addToRack(g.players[who], joker);
  g.forfeitPlayer(who);
  assert.ok(g.pool.includes(joker));
  assert.strictEqual(joker.rep, null);
});

test('a dropped player survives saving, loading and the pool running dry', () => {
  const g = table(3);
  g.forfeitPlayer((g.current + 1) % 3);
  const h = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.deepStrictEqual(h.players.map((p) => p.dropped), g.players.map((p) => p.dropped));
  assert.strictEqual(JSON.stringify(h), JSON.stringify(g), 'lossless');
  // play it out: the game must end without ever giving the dropped seat a turn
  const gone = h.players.findIndex((p) => p.dropped);
  let turns = 0;
  while (!h.over && turns++ < 3000) {
    assert.notStrictEqual(h.current, gone);
    h.playAI();
    h.nextTurn();
  }
  assert.ok(h.over);
  assert.strictEqual(h.result.ranking[h.result.ranking.length - 1], gone);
});

test('a saved game cannot say the dropped player has the move', () => {
  const g = table(3);
  g.forfeitPlayer((g.current + 1) % 3);
  const data = JSON.parse(JSON.stringify(g));
  data.current = data.players.findIndex((p) => p.dropped);
  assert.throws(() => Game.fromJSON(data), /not a valid saved game/);
});
