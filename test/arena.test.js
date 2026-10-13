const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/arena.js');
const { Game } = require('../src/game.js');
const L = require('../src/lobby.js');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const NOW = 1_800_000_000_000;
const entry = (n, extra = {}) => ({ uid: 'dev' + n, pid: ('a' + n).padEnd(16, '0'), name: 'Pl' + n, face: '🦄', cols: 30, hints: false, help: false, ...extra });
const make = (n, extra) => A.buildRandomGame(Array.from({ length: n }, (_, i) => entry(i + 1, extra)), { now: NOW, gid: 'abcdef0123456789', rng: seeded(11) });

test('a random game starts dealt, with everyone seated and no chat', () => {
  const built = make(3);
  const g = Game.fromJSON(JSON.parse(built.state.json));
  assert.strictEqual(g.players.length, 3);
  assert.ok(g.players.every((p) => g.rackTiles(p).length === 14));
  assert.strictEqual(g.cols, 30);
  assert.strictEqual(built.meta.phase, 'playing');
  assert.strictEqual(built.meta.options.chat, false);
  assert.strictEqual(built.meta.options.kind, 'random');
  assert.deepStrictEqual(Object.keys(built.meta.devices).sort(), ['dev1', 'dev2', 'dev3']);
  assert.strictEqual(built.seats.length, 3);
  assert.strictEqual(built.state.rev, 0);
  assert.strictEqual(built.meta.start.current, g.current);
});

test('a random game record reads back the way the app reads it', () => {
  const built = make(2);
  const meta = L.cleanMeta(built.meta);
  assert.ok(meta, 'the app accepts the game record');
  assert.strictEqual(meta.players.length, 2);
  assert.deepStrictEqual(meta.options, { hints: 0, help: false, chat: false, kind: 'random' });
  assert.ok(meta.start && meta.start.draws.length === 2);
  built.seats.forEach((s) => assert.ok(L.cleanSeat ? L.cleanSeat(s) : true));
});

test('hints and help are on only when every player asked for them', () => {
  assert.strictEqual(make(2, { hints: true, help: true }).meta.options.hints, 3);
  assert.strictEqual(make(2, { hints: true, help: true }).meta.options.help, true);
  const mixed = A.buildRandomGame([entry(1, { hints: true }), entry(2)], { now: NOW, gid: 'abcdef0123456789', rng: seeded(1) });
  assert.strictEqual(mixed.meta.options.hints, 0);
});

test('a table needs two to four players', () => {
  assert.throws(() => A.buildRandomGame([entry(1)], { now: NOW, gid: 'abcdef0123456789' }), /2 to 4/);
  assert.throws(() => A.buildRandomGame(Array.from({ length: 5 }, (_, i) => entry(i)), { now: NOW, gid: 'abcdef0123456789' }), /2 to 4/);
});

test('only a random game that is being played has a clock', () => {
  const built = make(2);
  const d = A.deadlineFor(built.meta, built.state, NOW);
  assert.strictEqual(d.due, NOW + 24 * 3600 * 1000);
  assert.strictEqual(d.remind, NOW + 20 * 3600 * 1000);
  assert.strictEqual(d.next, d.remind);
  assert.strictEqual(d.reminded, false);
  assert.strictEqual(A.deadlineFor({ ...built.meta, options: { kind: 'private' } }, built.state, NOW), null, 'friends set their own pace');
  assert.strictEqual(A.deadlineFor({ ...built.meta, phase: 'over' }, built.state, NOW), null);
  assert.strictEqual(A.deadlineFor(built.meta, null, NOW), null);
  assert.strictEqual(A.deadlineFor({ ...built.meta, options: undefined }, built.state, NOW), null, 'old games have no clock');
});

test('when time runs out, the player on the move drops out and the game goes on', () => {
  const built = make(3);
  const before = Game.fromJSON(JSON.parse(built.state.json));
  const out = A.forfeitTurn(built.state);
  assert.strictEqual(out.seat, before.current);
  assert.strictEqual(out.over, false);
  assert.strictEqual(out.record.rev, 1);
  assert.strictEqual(out.record.by, 'server');
  assert.strictEqual(out.record.forfeit, true);
  const after = Game.fromJSON(JSON.parse(out.record.json));
  assert.strictEqual(after.players[out.seat].dropped, true);
  assert.notStrictEqual(after.current, out.seat);
  assert.strictEqual(out.record.current, after.current);
  assert.strictEqual(after.pool.length, before.pool.length + 14);
});

test('in a game of two, the other player wins when time runs out', () => {
  const built = make(2);
  const out = A.forfeitTurn(built.state);
  assert.strictEqual(out.over, true);
  assert.strictEqual(out.winner, 1 - out.seat);
  const g = Game.fromJSON(JSON.parse(out.record.json));
  assert.strictEqual(g.result.reason, 'forfeit');
  assert.strictEqual(A.forfeitTurn(out.record), null, 'a finished game has nobody left to drop');
});

test('a damaged state is left alone', () => {
  assert.strictEqual(A.forfeitTurn({ rev: 3, json: '{nope' }), null);
});
