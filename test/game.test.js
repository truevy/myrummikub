const test = require('node:test');
const assert = require('node:assert');
const { analyzeSet, createTiles } = require('../src/engine.js');
const { computeMove, LEVELS } = require('../src/ai.js');
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

test('a set is nudged aside when a dropped tile would spoil it', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const p = g.players[0];
  p.rack.fill(null);
  [T(4, 1), T(5, 1), T(6, 1), T(9, 0), T(7, 1)].forEach((t, i) => (p.rack[i] = t));
  g.moveTile(0, { area: 'rack', idx: 0 }, { area: 'board', idx: 5 });
  g.moveTile(0, { area: 'rack', idx: 1 }, { area: 'board', idx: 6 });
  g.moveTile(0, { area: 'rack', idx: 2 }, { area: 'board', idx: 7 });
  assert.strictEqual(g.findSets().length, 1);
  // a black 9 dropped right after red 4-5-6 would break the run: the run moves left
  g.moveTile(0, { area: 'rack', idx: 3 }, { area: 'board', idx: 8 });
  const sets = g.findSets();
  assert.strictEqual(sets.length, 2);
  assert.strictEqual(sets[0].idx, 4);
  assert.ok(sets[0].valid);
  assert.strictEqual(sets[1].idx, 8);
  // a red 7 dropped between the run and the 9 joins the run, and the 9 is nudged on
  g.moveTile(0, { area: 'rack', idx: 4 }, { area: 'board', idx: 7 });
  const after = g.findSets();
  assert.strictEqual(after.length, 2);
  assert.strictEqual(after[0].tiles.length, 4);
  assert.ok(after[0].valid);
  assert.strictEqual(after[1].idx, 9);
});

test('a group dropped against another steps aside when the other cannot move', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const put = (idx, tiles) => tiles.forEach((t, i) => (g.board[idx + i] = t));
  // 1-2-3 sits against the left edge; 8-9-10 is dropped right behind it
  put(0, [T(1, 1), T(2, 1), T(3, 1)]);
  put(3, [T(8, 1), T(9, 1), T(10, 1)]);
  g.separate(3, 3);
  assert.deepStrictEqual(g.findSets().map((s) => [s.idx, s.tiles.length, s.valid]), [[0, 3, true], [4, 3, true]]);
  // the same against the right edge: the dropped group steps left
  g.board.fill(null);
  put(COLS - 3, [T(8, 2), T(9, 2), T(10, 2)]);
  put(COLS - 6, [T(1, 2), T(2, 2), T(3, 2)]);
  g.separate(COLS - 6, 3);
  assert.deepStrictEqual(g.findSets().map((s) => [s.idx, s.tiles.length]), [[COLS - 7, 3], [COLS - 3, 3]]);
});

test('drawing keeps tiles that were only moved around on the table', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(5));
  g.deal();
  g.beginTurn();
  const p = g.players[0];
  p.melded = true;
  [T(4, 1), T(5, 1), T(6, 1)].forEach((t, i) => (g.board[i] = t));
  g.beginTurn(); // the run is now part of the table this turn starts from
  assert.ok(g.moveSet(0, 0, 30).ok);
  const held = g.rackTiles(p).length;
  g.drawAndPass();
  assert.deepStrictEqual(g.findSets().map((s) => s.idx), [30], 'the run stays where it was moved to');
  assert.strictEqual(g.rackTiles(p).length, held + 1);
  // but a tile played from the rack is taken back, and the table with it
  g.nextTurn();
  g.nextTurn();
  const extra = T(7, 1);
  p.rack[p.rack.indexOf(null)] = extra;
  g.moveSet(0, 30, 2);
  g.moveTile(0, { area: 'rack', idx: p.rack.indexOf(extra) }, { area: 'board', idx: 5 });
  assert.strictEqual(g.findSets()[0].tiles.length, 4);
  g.drawAndPass();
  assert.deepStrictEqual(g.findSets().map((s) => [s.idx, s.tiles.length]), [[30, 3]]);
  assert.ok(g.rackTiles(p).includes(extra));
});

test('AI levels: beginners leave the table alone, experts rearrange it', () => {
  const steady = () => 0.5; // sees every tile, never overlooks a move
  const tableSets = [{ idx: 0, tiles: [T(4, 0), T(5, 0), T(6, 0), T(7, 0), T(8, 0), T(9, 0), T(10, 0)] }];
  const rack = [T(7, 1), T(7, 2)];
  assert.strictEqual(computeMove({ tableSets, rack, melded: true, level: 1, rng: steady }).type, 'draw');
  assert.strictEqual(computeMove({ tableSets, rack, melded: true, level: 2, rng: steady }).type, 'draw');
  assert.strictEqual(computeMove({ tableSets, rack, melded: true, level: 5, rng: steady }).type, 'play');
  // easy extends a run but never splits one
  const ext = computeMove({ tableSets, rack: [T(11, 0), T(1, 1)], melded: true, level: 2, rng: steady });
  assert.strictEqual(ext.type, 'play');
  assert.strictEqual(ext.played.length, 1);
  assert.ok(analyzeSet(ext.sets[0].tiles).valid);
  assert.strictEqual(ext.sets[0].tiles.length, 8);
  // a beginner overlooks moves now and then
  const unlucky = () => 0.1;
  assert.strictEqual(computeMove({ tableSets, rack: [T(11, 0)], melded: true, level: 1, rng: unlucky }).type, 'draw');
  assert.strictEqual(Object.keys(LEVELS).length, 5);
});

test('mixed-level AI games finish and keep a replayable log', () => {
  for (let seed = 20; seed < 26; seed++) {
    const g = new Game(
      { players: [1, 3, 5, 2].map((level, i) => ({ name: 'AI' + i, isAI: true, level })) },
      seeded(seed)
    );
    g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    let turns = 0;
    while (!g.over && turns++ < 3000) {
      g.playAI();
      for (const s of g.findSets()) assert.ok(s.valid);
      g.nextTurn();
    }
    assert.ok(g.over);
    assert.strictEqual(g.history.length, turns);
    for (const h of g.history) {
      assert.strictEqual(h.after.board.length, h.after.rows * COLS);
      const after = new Set(h.after.board.filter((id) => id !== null));
      h.played.forEach((id) => assert.ok(after.has(id), 'played tiles end up on the table'));
      h.before.board.forEach((id) => id !== null && assert.ok(after.has(id), 'table tiles stay on the table'));
    }
    const copy = Game.fromJSON(JSON.parse(JSON.stringify(g)));
    assert.deepStrictEqual(copy.history, g.history);
    assert.deepStrictEqual(copy.players.map((p) => p.level), [1, 3, 5, 2]);
  }
});

// ---- jokers keep the identity they were played with -------------------------

const JK = (id) => ({ id, value: 0, color: -1, joker: true, rep: null });

function tableWithJoker() {
  // a game where red 5, joker, red 7 has been played and the turn has passed
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }] }, seeded(11));
  g.deal();
  g.players.forEach((p) => (p.melded = true));
  g.beginTurn();
  const a = g.players[0];
  const joker = g.jokers[0];
  // make sure the joker is nowhere else, then hand player A the three tiles
  for (const p of g.players) p.rack = p.rack.map((t) => (t === joker ? null : t));
  g.pool = g.pool.filter((t) => t !== joker);
  a.rack.fill(null);
  const five = T(5, 1);
  const seven = T(7, 1);
  [five, joker, seven].forEach((t, i) => (a.rack[i] = t));
  a.rack[9] = T(1, 3); // a spare, so that playing the three does not end A's game
  g.turn.startRack = a.rack.slice();
  [0, 1, 2].forEach((i) => assert.ok(g.moveTile(0, { area: 'rack', idx: i }, { area: 'board', idx: 30 + i }).ok));
  assert.strictEqual(g.jokerView().get(joker.id).value, 6, 'shown as a 6 as soon as the set is valid');
  assert.ok(g.endTurn().ok);
  g.nextTurn();
  return { g, joker, five, seven };
}

test('a played joker becomes that tile and stays it when moved', () => {
  const { g, joker } = tableWithJoker();
  assert.deepStrictEqual(joker.rep, { value: 6, colors: [1] });
  const b = g.players[1];
  b.rack.fill(null);
  [T(8, 1), T(9, 1), T(4, 2), T(5, 2)].forEach((t, i) => (b.rack[i] = t));
  g.turn.startRack = b.rack.slice();
  // moving it beside blue 4-5 does not make it a blue 6
  g.moveTile(1, { area: 'rack', idx: 2 }, { area: 'board', idx: 60 });
  g.moveTile(1, { area: 'rack', idx: 3 }, { area: 'board', idx: 61 });
  g.moveTile(1, { area: 'board', idx: 31 }, { area: 'board', idx: 62 });
  const blue = g.findSets().find((s) => s.idx === 60);
  assert.ok(!blue.valid, 'still a red 6, so not a blue run');
  assert.strictEqual(g.jokerView().get(joker.id).value, 6);
  assert.ok(!g.turnStatus().canEnd);
  g.resetTurn();
  // but red 8-9 with the joker's own run is fine: 5 J 7 8 9
  g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 33 });
  g.moveTile(1, { area: 'rack', idx: 1 }, { area: 'board', idx: 34 });
  assert.ok(g.turnStatus().canEnd);
  assert.ok(g.endTurn().ok);
  assert.deepStrictEqual(joker.rep, { value: 6, colors: [1] }, 'unchanged');
});

test('playing the real tile frees the joker, which must then be used', () => {
  const { g, joker } = tableWithJoker();
  const b = g.players[1];
  b.rack.fill(null);
  [T(6, 1), T(11, 0), T(12, 0)].forEach((t, i) => (b.rack[i] = t));
  g.turn.startRack = b.rack.slice();
  assert.strictEqual(g.releasedJokers().size, 0);
  // swap: the joker out, the red 6 in
  g.moveTile(1, { area: 'board', idx: 31 }, { area: 'board', idx: 90 });
  g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 31 });
  assert.ok(g.releasedJokers().has(joker.id));
  assert.deepStrictEqual(g.jokerView().get(joker.id), { value: null, colors: [], pending: true });
  assert.ok(!g.turnStatus().canEnd);
  assert.match(g.turnStatus().msg, /freed a joker/);
  // taking the 6 back binds the joker again
  g.moveTile(1, { area: 'board', idx: 31 }, { area: 'rack', idx: 0 });
  assert.strictEqual(g.releasedJokers().size, 0);
  assert.strictEqual(g.jokerView().get(joker.id).value, 6);
  g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 31 });
  // use it: black 11, 12, joker
  g.moveTile(1, { area: 'rack', idx: 1 }, { area: 'board', idx: 88 });
  g.moveTile(1, { area: 'rack', idx: 2 }, { area: 'board', idx: 89 });
  assert.deepStrictEqual(g.jokerView().get(joker.id), { value: 13, colors: [0], pending: false });
  assert.ok(g.turnStatus().canEnd);
  assert.ok(g.endTurn().ok);
  assert.deepStrictEqual(joker.rep, { value: 13, colors: [0] }, 'a new identity');
});

test('joker identities survive save and load', () => {
  let checked = 0;
  for (let seed = 30; seed < 45 && checked < 3; seed++) {
    const g = new Game({ players: [0, 1, 2].map((i) => ({ name: 'AI' + i, isAI: true })) }, seeded(seed));
    g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    for (let turns = 0; !g.over && turns < 400; turns++) {
      g.playAI();
      const onTable = g.jokers.filter((t) => g.board.includes(t));
      for (const t of onTable) assert.ok(t.rep && t.rep.value >= 1 && t.rep.colors.length > 0, 'a joker on the table always stands for something');
      for (const t of g.jokers) if (!g.board.includes(t)) assert.strictEqual(t.rep, null, 'a joker off the table stands for nothing');
      if (onTable.length && !g.over) {
        const copy = Game.fromJSON(JSON.parse(JSON.stringify(g)));
        assert.deepStrictEqual(copy.jokers.map((t) => t.rep), g.jokers.map((t) => t.rep));
        checked++;
        break;
      }
      g.nextTurn();
    }
  }
  assert.ok(checked > 0, 'at least one game put a joker on the table');
});

test('computer players respect a joker\'s identity and can free it', () => {
  const j = JK(104);
  j.rep = { value: 6, colors: [1] };
  const tableSets = [{ idx: 0, tiles: [T(5, 1), j, T(7, 1)] }];
  const steady = () => 0.5;
  // blue 9-10 cannot borrow the joker as a blue 11
  const stuck = computeMove({ tableSets, rack: [T(9, 2), T(10, 2)], melded: true, level: 5, rng: steady });
  assert.strictEqual(stuck.type, 'draw');
  // with the red 6 in hand the joker is freed and joins blue 9-10
  const freed = computeMove({ tableSets, rack: [T(6, 1), T(9, 2), T(10, 2)], melded: true, level: 5, rng: steady });
  assert.strictEqual(freed.type, 'play');
  assert.strictEqual(freed.played.length, 3);
  const withJoker = freed.sets.find((s) => s.tiles.includes(j));
  assert.ok(withJoker.tiles.some((t) => t.color === 2), 'the joker now sits with the blue tiles');
  // the joker can still move as a red 6: red 6-7-8 from 5-J-7 plus red 4, 8
  const moved = computeMove({ tableSets, rack: [T(8, 1), T(4, 1)], melded: true, level: 5, rng: steady });
  assert.strictEqual(moved.type, 'play');
  assert.strictEqual(moved.played.length, 2);
});

test('dropping the real tile on a joker swaps them', () => {
  // from the rack: the tile takes the joker's cell, the joker waits on its own
  let { g, joker } = tableWithJoker();
  let b = g.players[1];
  b.rack.fill(null);
  [T(6, 1), T(11, 0), T(12, 0)].forEach((t, i) => (b.rack[i] = t));
  g.turn.startRack = b.rack.slice();
  const res = g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 31 });
  assert.deepStrictEqual(res, { ok: true, swapped: true });
  const run = g.findSets().find((s) => s.idx === 30);
  assert.deepStrictEqual(run.tiles.map((t) => t.value), [5, 6, 7]);
  assert.ok(run.valid);
  assert.ok(g.releasedJokers().has(joker.id));
  const at = g.board.indexOf(joker);
  assert.ok(at >= 0 && !g.board[at - 1] && !g.board[at + 1], 'the joker stands alone');
  assert.strictEqual(g.jokerView().get(joker.id).pending, true);
  assert.ok(!g.turnStatus().canEnd);
  g.resetTurn();
  assert.strictEqual(g.board.indexOf(joker), 31, 'take back puts the joker where it was');
  assert.strictEqual(g.releasedJokers().size, 0);

  // from the table: a red 6 from a group of 6s trades places with the joker
  ({ g, joker } = tableWithJoker());
  b = g.players[1];
  b.rack.fill(null);
  [T(6, 0), T(6, 1), T(6, 2), T(6, 3), T(2, 3)].forEach((t, i) => (b.rack[i] = t));
  g.turn.startRack = b.rack.slice();
  [0, 1, 2, 3].forEach((i) => g.moveTile(1, { area: 'rack', idx: i }, { area: 'board', idx: 60 + i }));
  assert.ok(g.endTurn().ok);
  g.nextTurn();
  g.nextTurn(); // back to player B, who now only rearranges the table
  assert.strictEqual(g.current, 1);
  const swap = g.moveTile(1, { area: 'board', idx: 61 }, { area: 'board', idx: 31 });
  assert.ok(swap.swapped);
  assert.strictEqual(g.board[61], joker, 'the joker took the red 6\'s old place');
  assert.ok(g.findSets().every((s) => s.valid), 'both sets are valid straight away');
  assert.deepStrictEqual(g.jokerView().get(joker.id), { value: 6, colors: [1], pending: false });
  // a tile that does not match is simply inserted, as before
  const copy = tableWithJoker();
  copy.g.players[1].rack.fill(null);
  copy.g.players[1].rack[0] = T(9, 1);
  copy.g.turn.startRack = copy.g.players[1].rack.slice();
  const ins = copy.g.moveTile(1, { area: 'rack', idx: 0 }, { area: 'board', idx: 31 });
  assert.ok(ins.ok && !ins.swapped);
  assert.strictEqual(copy.g.board[32], copy.joker, 'pushed along, not swapped');
});
