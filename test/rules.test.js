const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
const flatten = (node, out = []) => {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => flatten(v, out));
  return out;
};
const { v3, ...legacy } = rules;

test('3.0 keeps its data under v3, away from earlier versions', () => {
  assert.ok(v3 && typeof v3 === 'object', 'there is a v3 node');
  for (const key of ['players', 'handles', 'queue', 'recent', 'deadlines', 'games', 'invites', 'inbox', 'names', 'rankings', 'presence', 'friends', 'devices', 'accounts', 'links', 'pushTokens']) {
    assert.ok(v3[key], `v3/${key} has rules`);
  }
});

test('every path a v3 rule looks at is inside v3', () => {
  const texts = flatten(v3);
  const looksAt = texts.flatMap((t) => [...t.matchAll(/root\.child\('([^']*)'/g)].map((m) => m[1]));
  assert.ok(looksAt.length > 20, 'the rules do refer to other data');
  for (const p of looksAt) assert.ok(p.startsWith('v3/'), `a v3 rule reads ${p}`);
});

test('the rules of earlier versions are left as they were', () => {
  const texts = flatten(legacy);
  assert.ok(texts.every((t) => !t.includes('v3/')), 'nothing in the old rules mentions v3');
  for (const gone of ['handles', 'queue', 'recent', 'deadlines']) {
    assert.strictEqual(legacy[gone], undefined, `${gone} is new in 3.0, so it is not at the top level`);
  }
  for (const key of ['players', 'names', 'games', 'invites', 'inbox']) assert.ok(legacy[key], `${key} still has its old rules`);
});

test('v3 has the same shape as the old data plus what 3.0 added', () => {
  for (const key of Object.keys(legacy).filter((k) => !k.startsWith('.'))) assert.ok(v3[key], `v3/${key} exists`);
  assert.strictEqual(legacy['.read'], false, 'everything not named is closed by default');
  assert.strictEqual(legacy['.write'], false);
  assert.strictEqual(v3['.read'], undefined, 'v3 adds no blanket access of its own');
  assert.strictEqual(v3['.write'], undefined);
});

test('anyone signed in can read the number of registered players, but only the server writes it', () => {
  assert.strictEqual(v3.stats['.read'], 'auth != null');
  assert.strictEqual(v3.stats['.write'], false);
  assert.strictEqual(legacy.stats, undefined, 'it is new in 3.0');
});
