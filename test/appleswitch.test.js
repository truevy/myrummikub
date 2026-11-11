const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
const body = (name) => {
  const at = ui.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  return ui.slice(at, ui.indexOf('\n  }\n', at));
};

test('switching to an Apple ID\'s account lets go of everything of the old one, as logging out does', () => {
  const adopt = body('adoptAccount');
  assert.match(adopt, /stopAccount\(\)/, 'the old account\'s games, lobby, invitations and friends stop being watched');
  assert.match(adopt, /forgetPlayers\(/, 'the old account\'s players leave this device');
  assert.match(adopt, /db\.me = /, 'the device plays as one of the Apple ID\'s players');
  const logOut = body('logOut');
  assert.match(logOut, /stopAccount\(\)/);
  assert.match(logOut, /forgetPlayers\(mine\)/);
});

test('the switch is asked first, and not in the middle of an online game', () => {
  const finish = body('finishAppleSignIn');
  assert.ok(finish.indexOf('isOnline()') < finish.indexOf('confirmAppleSwitch(own)'));
  assert.ok(finish.indexOf('confirmAppleSwitch(own)') < finish.indexOf('result.switchTo('));
  const ask = body('confirmAppleSwitch');
  assert.match(ask, /Welcome back/);
  assert.match(ask, /'apple-card'/, 'its own card: the compact profile card hides its title on an iPhone');
});
