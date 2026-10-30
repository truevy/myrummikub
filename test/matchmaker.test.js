const test = require('node:test');
const assert = require('node:assert');
const { pickMatches, colsFor, WAIT_LIMIT_MS } = require('../src/matchmaking.js');

const NOW = 1_000_000_000_000;
const e = (uid, size, lastSeen, extra = {}) => ({ uid, pid: uid + 'pid', size, lastSeen, at: NOW - 1000, active: 0, multi: false, cols: 30, ...extra });

test('the most recently active players are matched first', () => {
  const queue = [e('a', 2, NOW - 5000), e('b', 2, NOW - 100), e('c', 2, NOW - 9000), e('d', 2, NOW - 50)];
  const { matches } = pickMatches(queue, NOW);
  assert.deepStrictEqual(matches.map((m) => m.map((x) => x.uid)), [['d', 'b'], ['a', 'c']]);
});

test('players are grouped by the size of game they asked for', () => {
  const queue = [e('a', 3, 5), e('b', 2, 4), e('c', 3, 3), e('d', 2, 2), e('f', 3, 1), e('g', 4, 9)];
  const { matches } = pickMatches(queue, NOW);
  assert.deepStrictEqual(matches.map((m) => m.map((x) => x.uid).sort()), [['b', 'd'], ['a', 'c', 'f']]);
});

test('too few players means no game yet', () => {
  assert.deepStrictEqual(pickMatches([e('a', 4, 1), e('b', 4, 2), e('c', 4, 3)], NOW).matches, []);
});

test('the same person is never matched with themselves', () => {
  const { matches } = pickMatches([e('a', 2, 5), e('a', 2, 4), e('b', 2, 3)], NOW);
  assert.strictEqual(matches.length, 1);
  assert.deepStrictEqual(matches[0].map((x) => x.uid).sort(), ['a', 'b']);
});

test('someone already in a game waits unless they accept more than one', () => {
  const busy = e('a', 2, 9, { active: 1 });
  const keen = e('k', 2, 9, { active: 2, multi: true });
  const { matches } = pickMatches([busy, keen, e('b', 2, 8), e('c', 2, 7)], NOW);
  assert.deepStrictEqual(matches.map((m) => m.map((x) => x.uid)), [['k', 'b']]);
});

test('a request nobody answered for three days expires', () => {
  const old = e('a', 2, 9, { at: NOW - WAIT_LIMIT_MS - 1 });
  const { matches, expired } = pickMatches([old, e('b', 2, 8), e('c', 2, 7)], NOW);
  assert.deepStrictEqual(expired.map((x) => x.uid), ['a']);
  assert.deepStrictEqual(matches.map((m) => m.map((x) => x.uid)), [['b', 'c']]);
});

test('malformed requests are ignored', () => {
  const { matches } = pickMatches([null, { uid: 'x', size: 9 }, e('a', 2, 3), e('b', 2, 2)], NOW);
  assert.strictEqual(matches.length, 1);
});

test('a game uses the narrowest table anyone asked for', () => {
  assert.strictEqual(colsFor([e('a', 2, 1, { cols: 36 }), e('b', 2, 1, { cols: 28 })]), 28);
  assert.strictEqual(colsFor([e('a', 2, 1, { cols: undefined })]), 30);
});

test('two people when one has blocked the other are never seated together', () => {
  const queue = [e('a', 2, NOW - 10, { blocks: ['bpid'] }), e('b', 2, NOW - 20), e('c', 2, NOW - 30), e('d', 2, NOW - 40)];
  const { matches } = pickMatches(queue, NOW);
  assert.deepStrictEqual(matches.map((m) => m.map((x) => x.uid)), [['a', 'c'], ['b', 'd']]);
  // nobody else wants a game: they wait rather than meet
  assert.deepStrictEqual(pickMatches(queue.slice(0, 2), NOW).matches, []);
});
