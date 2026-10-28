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

test('the Notifications row says what the device says and offers the one useful thing', () => {
  assert.strictEqual(notificationRow('granted', true).action, null);
  assert.match(notificationRow('granted', true).text, /^On\./);
  assert.strictEqual(notificationRow('undecided', true).action, 'enable');
  assert.strictEqual(notificationRow('denied', true).action, 'settings');
  assert.match(notificationRow('denied', true).text, /device Settings/);
  assert.strictEqual(notificationRow(null, true).text, 'Checking…');
  assert.strictEqual(notificationRow('granted', false).action, null, 'no row in a browser');
  assert.match(notificationRow('granted', false).text, /phone, tablet, Mac and Windows/);
});

test('on a Mac or Windows PC, notifications need no asking but the app has to keep running', () => {
  const on = notificationRow('granted', 'desktop');
  assert.strictEqual(on.action, null);
  assert.match(on.text, /running/);
  assert.match(notificationRow(null, 'desktop').text, /background/);
  assert.strictEqual(notificationRow('denied', 'desktop').action, 'settings');
});

test('a game on this computer can be quit; an online game and a finished game cannot', () => {
  const { visibleTools } = require('../src/menu.js');
  assert.strictEqual(visibleTools({ online: false, hasComputer: true, over: false }).quit, true, 'single player');
  assert.strictEqual(visibleTools({ online: false, hasComputer: false, over: false }).quit, true, 'same computer');
  assert.strictEqual(visibleTools({ online: true, hasComputer: false, over: false }).quit, false);
  assert.strictEqual(visibleTools({ online: false, hasComputer: true, over: true }).quit, false);
});
