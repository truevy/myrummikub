const test = require('node:test');
const assert = require('node:assert');
const { analyzeSet, createTiles } = require('../src/engine.js');
const { computeMove } = require('../src/ai.js');
const { Game, COLS, gridInsert } = require('../src/game.js');

const T = (value, color) => ({ id: Math.random(), value, color, joker: false });
const J = () => ({ id: Math.random(), value: 0, color: -1, joker: true });

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('tile set has 106 tiles', () => {
  assert.strictEqual(createTiles().length, 106);
});

test('set validation', () => {
  assert.ok(analyzeSet([T(3, 0), T(4, 0), T(5, 0)]).valid);
  assert.strictEqual(analyzeSet([T(3, 0), T(4, 0), T(5, 0)]).points, 12);
  assert.ok(analyzeSet([T(7, 0), T(7, 1), T(7, 2), T(7, 3)]).valid);
  assert.ok(analyzeSet([T(11, 1), J(), T(13, 1)]).valid);
  assert.strictEqual(analyzeSet([T(11, 1), J(), T(13, 1)]).points, 36);
  assert.ok(!analyzeSet([T(12, 1), T(13, 1), T(1, 1)]).valid, 'no wrap around');
  assert.ok(!analyzeSet([T(12, 1), T(13, 1), J()]).valid, 'joker cannot be 14');
  assert.ok(!analyzeSet([J(), T(1, 1), T(2, 1)]).valid, 'joker cannot be 0');
  assert.ok(!analyzeSet([T(7, 0), T(7, 0), T(7, 2)]).valid, 'duplicate colour in group');
  assert.ok(!analyzeSet([T(5, 0), T(4, 0), T(3, 0)]).valid, 'runs ascend');
  assert.ok(!analyzeSet([T(3, 0), T(4, 0)]).valid);
  assert.ok(!analyzeSet([T(7, 0), T(7, 1), T(7, 2), T(7, 3), J()]).valid);
});

test('gridInsert pushes neighbours', () => {
  const cells = ['a', 'b', null, null];
  assert.ok(gridInsert(cells, 4, 0, 'x'));
  assert.deepStrictEqual(cells, ['x', 'a', 'b', null]);
  const full = ['a', 'b', 'c', 'd'];
  assert.ok(!gridInsert(full, 4, 1, 'x'));
});

test('AI refuses a first meld under 30 and makes one over 30', () => {
  const low = computeMove({ tableSets: [], rack: [T(1, 0), T(2, 0), T(3, 0), T(9, 1)], melded: false });
  assert.strictEqual(low.type, 'draw');
  const high = computeMove({ tableSets: [], rack: [T(10, 0), T(11, 0), T(12, 0), T(2, 1)], melded: false });
  assert.strictEqual(high.type, 'play');
  assert.strictEqual(high.played.length, 3);
});

test('AI rearranges the table to play a tile', () => {
  // table: red 3-4-5-6 and a group of 7s; rack: red 7 -> extend the run
  const tableSets = [
    { idx: 0, tiles: [T(3, 1), T(4, 1), T(5, 1), T(6, 1)] },
    { idx: 10, tiles: [T(8, 0), T(8, 2), T(8, 3)] },
  ];
  const move = computeMove({ tableSets, rack: [T(8, 1), T(1, 2)], melded: true });
  assert.strictEqual(move.type, 'play');
  assert.strictEqual(move.played.length, 1);
  move.sets.forEach((s) => assert.ok(analyzeSet(s.tiles).valid));

  // needs a split: black 1-2-3-4-5-6 on the table, rack has black 3 + black... use manipulation
  const t2 = [{ idx: 0, tiles: [T(4, 0), T(5, 0), T(6, 0), T(7, 0), T(8, 0), T(9, 0), T(10, 0)] }];
  const m2 = computeMove({ tableSets: t2, rack: [T(7, 1), T(7, 2)], melded: true });
  assert.strictEqual(m2.type, 'play', 'splits the run to free the black 7');
  assert.strictEqual(m2.played.length, 2);
  m2.sets.forEach((s) => assert.ok(analyzeSet(s.tiles).valid));
});

test('human turn rules', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const p = g.players[0];
  p.rack.fill(null);
  const tiles = [T(10, 0), T(11, 0), T(12, 0), T(2, 1)];
  tiles.forEach((t, i) => (p.rack[i] = t));
  g.turn.startRack = p.rack.slice();
  assert.ok(!g.turnStatus().canEnd);
  assert.ok(g.moveTile(0, { area: 'rack', idx: 0 }, { area: 'board', idx: 0 }).ok);
  assert.ok(g.moveTile(0, { area: 'rack', idx: 1 }, { area: 'board', idx: 1 }).ok);
  assert.ok(!g.turnStatus().canEnd);
  assert.ok(g.moveTile(0, { area: 'rack', idx: 2 }, { area: 'board', idx: 2 }).ok);
  assert.ok(g.turnStatus().canEnd);
  assert.strictEqual(g.turnStatus().points, 33);
  assert.ok(!g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 30 }).ok, 'not their turn');
  const hint = g.hint();
  assert.strictEqual(hint.type, 'play');
  assert.strictEqual(hint.played.length, 3, 'hint counts tiles already placed');
  g.resetTurn();
  assert.ok(g.moveTile(0, { area: 'rack', idx: 3 }, { area: 'board', idx: 40 }).ok, 'a stray tile is on the table');
  const solved = g.applyHint();
  assert.deepStrictEqual(solved, { ok: true, count: 3 });
  assert.strictEqual(g.rackTiles(p).length, 1, 'the stray tile went back to the rack');
  assert.ok(g.turnStatus().canEnd, 'the solved table can be ended');
  assert.ok(!g.acted, 'solving does not end the turn');
  g.resetTurn();
  assert.strictEqual(g.rackTiles(p).length, 4);
  assert.strictEqual(g.board.filter(Boolean).length, 0);
});

test('full AI games stay consistent and finish', () => {
  let slowest = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game(
      { players: [0, 1, 2, 3].slice(0, 2 + (seed % 3)).map((i) => ({ name: 'AI' + i, isAI: true })) },
      seeded(seed)
    );
    g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    let turns = 0;
    while (!g.over && turns < 2000) {
      const t0 = Date.now();
      g.playAI();
      slowest = Math.max(slowest, Date.now() - t0);
      const onTable = g.board.filter(Boolean);
      const inRacks = g.players.reduce((s, p) => s + g.rackTiles(p).length, 0);
      assert.strictEqual(onTable.length + inRacks + g.pool.length, 106, 'tiles are conserved');
      assert.strictEqual(new Set(onTable.map((t) => t.id)).size, onTable.length);
      for (const s of g.findSets()) assert.ok(s.valid, `invalid set on table (seed ${seed})`);
      assert.strictEqual(g.board.length, g.rows * COLS);
      g.nextTurn();
      turns++;
    }
    assert.ok(g.over, `game ${seed} finished`);
    assert.strictEqual(g.result.ranking.length, g.players.length);
    if (g.result.reason === 'out') {
      assert.strictEqual(g.board.filter(Boolean).length + g.pool.length, 106, 'every rack is empty');
      g.players.forEach((p) => assert.ok(p.place > 0));
    } else {
      assert.strictEqual(g.pool.length, 0, 'a stalemate needs an empty pool');
    }
    console.log(`seed ${seed}: ${g.players.length} players, ${turns} turns, ${g.result.reason}, ranking ${g.result.ranking}`);
  }
  console.log('slowest AI move (ms):', slowest);
});

test('a saved game loads and plays on exactly as before', () => {
  const g = new Game({ players: [0, 1, 2].map((i) => ({ name: 'AI' + i, isAI: true })) }, seeded(3));
  g.pickFirstPlayer();
  g.deal();
  g.beginTurn();
  for (let i = 0; i < 20; i++) {
    g.playAI();
    g.nextTurn();
  }
  g.playAI(); // saved after a move, before the turn is passed on
  const text = JSON.stringify(g);
  const h = Game.fromJSON(JSON.parse(text));
  assert.strictEqual(JSON.stringify(h), text, 'round trip is lossless');
  assert.ok(h.acted);
  let turns = 0;
  for (const game of [g, h]) {
    turns = 0;
    game.nextTurn();
    while (!game.over && turns++ < 2000) {
      game.playAI();
      for (const s of game.findSets()) assert.ok(s.valid);
      game.nextTurn();
    }
    assert.ok(game.over);
  }
  assert.deepStrictEqual(h.result, g.result, 'both copies end the same way');
});

test('saving in the middle of a human turn keeps the tiles already placed', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const first = g.players[0].rack.findIndex(Boolean);
  const tile = g.players[0].rack[first];
  assert.ok(g.moveTile(0, { area: 'rack', idx: first }, { area: 'board', idx: 3 }).ok);
  const h = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.strictEqual(h.board[3].id, tile.id);
  assert.strictEqual(h.placedTiles().length, 1);
  assert.ok(!h.acted);
  h.resetTurn();
  assert.strictEqual(h.players[0].rack[first].id, tile.id, 'take back still works after loading');
});

test('broken save files are rejected', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const good = () => JSON.parse(JSON.stringify(g));
  assert.doesNotThrow(() => Game.fromJSON(good()));
  const cases = {
    'not an object': () => 'hello',
    'wrong version': () => Object.assign(good(), { version: 99 }),
    'duplicated tile': () => {
      const d = good();
      d.pool[0] = d.pool[1];
      return d;
    },
    'missing tile': () => {
      const d = good();
      d.pool.pop();
      return d;
    },
    'bad player index': () => Object.assign(good(), { current: 7 }),
    'no turn': () => Object.assign(good(), { turn: null }),
    'too many players': () => {
      const d = good();
      d.players = d.players.concat(d.players, d.players);
      return d;
    },
  };
  for (const [name, make] of Object.entries(cases)) {
    assert.throws(() => Game.fromJSON(make()), /not a valid saved game/, name);
  }
});
