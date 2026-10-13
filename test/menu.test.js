const test = require('node:test');
const assert = require('node:assert');
const { visibleTools } = require('../src/menu.js');

test('pause and speed are offered only when a computer is playing', () => {
  const vs = visibleTools({ online: false, hasComputer: true, over: false });
  assert.ok(vs.pause && vs.speed);
  const humans = visibleTools({ online: false, hasComputer: false, over: false });
  assert.ok(!humans.pause && !humans.speed);
});

test('an online game has no pause, speed or save', () => {
  const t = visibleTools({ online: true, hasComputer: false, over: false });
  assert.ok(!t.pause && !t.speed && !t.save);
  assert.ok(t.sound && t.settings && t.online && t.load && t.newGame);
});

test('the same tools show before and after the first turn', () => {
  const a = visibleTools({ online: false, hasComputer: true, over: false });
  const b = visibleTools({ online: false, hasComputer: true, over: false });
  assert.deepStrictEqual(a, b);
});

test('a finished game cannot be paused', () => {
  assert.ok(!visibleTools({ online: false, hasComputer: true, over: true }).pause);
});

const { notificationRow } = require('../src/menu.js');

test('the Notifications row says what iOS says and offers the one useful thing', () => {
  assert.strictEqual(notificationRow('granted', true).action, null);
  assert.match(notificationRow('granted', true).text, /^On\./);
  assert.strictEqual(notificationRow('undecided', true).action, 'enable');
  assert.strictEqual(notificationRow('denied', true).action, 'settings');
  assert.match(notificationRow('denied', true).text, /iOS Settings/);
  assert.strictEqual(notificationRow(null, true).text, 'Checking…');
  assert.strictEqual(notificationRow('granted', false).action, null, 'no row outside the iPhone and iPad app');
  assert.match(notificationRow('granted', false).text, /iPhone and iPad app/);
});
