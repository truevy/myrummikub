// A thousand played-out games in which every turn takes the hint, after the
// player has first pushed some tiles around at random. Whatever the hint lays
// down must leave nothing but valid sets on the table and lose no tile.
//
//   FUZZ_GAMES=50 npm test     a quicker run
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/game.js');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const show = (tiles) => tiles.map((t) => (t.joker ? 'J' + (t.rep ? t.rep.value : '') : t.value + 'c' + t.color)).join(' ');
const count = (g) => g.board.filter(Boolean).length + g.players.reduce((n, p) => n + g.rackTiles(p).length, 0) + g.pool.length;

test('a hinted move never leaves a broken table', () => {
  const games = Number(process.env.FUZZ_GAMES) || 1000;
  let hints = 0;
  let played = 0;
  for (let seed = 1; seed <= games; seed++) {
    const rng = seeded(seed * 7919);
    const g = new Game({ players: Array.from({ length: 2 + (seed % 3) }, (_, i) => ({ name: 'P' + i })) }, seeded(seed));
    g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    for (let turn = 0; turn < 400 && !g.over; turn++) {
      const p = g.players[g.current];
      for (let k = Math.floor(rng() * 4); k > 0; k--) {
        const pick = (list) => list[Math.floor(rng() * list.length)];
        const inRack = p.rack.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
        const onTable = g.board.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
        const to = { area: 'board', idx: Math.floor(rng() * g.board.length) };
        if (rng() < 0.6 && inRack.length) g.moveTile(g.current, { area: 'rack', idx: pick(inRack) }, to);
        else if (onTable.length) g.moveTile(g.current, { area: 'board', idx: pick(onTable) }, to);
      }
      const res = g.applyHint();
      hints++;
      const where = `game ${seed}, turn ${turn}`;
      assert.strictEqual(count(g), 106, `tiles are conserved (${where})`);
      if (res.ok) {
        played++;
        for (const s of g.findSets()) assert.ok(s.valid, `the hint left “${show(s.tiles)}” on the table (${where})`);
        assert.ok(g.endTurn().ok, `the hinted move can be ended (${where})`);
      } else g.drawAndPass();
      g.nextTurn();
    }
  }
  console.log(`${games} games, ${hints} hints taken, ${played} of them played tiles`);
});
