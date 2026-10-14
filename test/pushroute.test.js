const test = require('node:test');
const assert = require('node:assert');
const { serviceOf, fcmMessage, fcmTokenGone } = require('../functions/routing.js');

test('a device token goes to the push service it came from', () => {
  assert.strictEqual(serviceOf({ env: 'production' }), 'apns');
  assert.strictEqual(serviceOf({ env: 'sandbox' }), 'apns-sandbox');
  assert.strictEqual(serviceOf({ env: 'fcm', platform: 'android' }), 'fcm');
  assert.strictEqual(serviceOf({ at: 1 }), 'apns', 'tokens saved before Android existed are Apple tokens');
  assert.strictEqual(serviceOf({ env: 'carrier-pigeon' }), null);
  assert.strictEqual(serviceOf(null), null);
  assert.strictEqual(serviceOf('x'), null);
});

test('an Android notification carries the game to open and is sent at high priority', () => {
  const m = fcmMessage('tok', { title: 'Your turn', body: 'Go', gid: 'abc123' });
  assert.deepStrictEqual(m.notification, { title: 'Your turn', body: 'Go' });
  assert.deepStrictEqual(m.data, { gid: 'abc123' });
  assert.strictEqual(m.android.priority, 'high');
  assert.strictEqual(m.android.notification.channelId, 'turns');
  assert.deepStrictEqual(fcmMessage('tok', { title: 'a', body: 'b' }).data, {});
});

test('a dead Android token is forgotten, a passing error is not', () => {
  assert.ok(fcmTokenGone({ code: 'messaging/registration-token-not-registered' }));
  assert.ok(!fcmTokenGone({ code: 'messaging/internal-error' }));
  assert.ok(!fcmTokenGone(null));
});
