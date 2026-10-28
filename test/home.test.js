const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const start = ui.slice(ui.indexOf('function showStart()'), ui.indexOf('// Who may sit at the table in each kind of local game'));
const over = ui.slice(ui.indexOf('function showGameOver()'), ui.indexOf('// The choice, when a game is set up'));

test('the start screen is the three kinds of game and a menu, with nothing that scrolls', () => {
  assert.strictEqual((start.match(/data-mode="/g) || []).length, 3);
  assert.match(start, /id="start-more"/, 'a ☰ button');
  for (const id of ['menu-games', 'load-saved', 'open-roster', 'open-settings', 'watch']) assert.match(start, new RegExp(`id="${id}"`), `${id} is in the menu`);
  assert.doesNotMatch(start, /class="start-links"/, 'no row of links under the games');
  assert.doesNotMatch(start, /id="start-games"/, 'no list of games under the games');
  // one layout for every screen: the menu has no phone-only twin
  assert.doesNotMatch(start, /compact-only|phone-only/);
  assert.match(start, /'wide start'/);
  assert.match(css, /\.card\.start \{ overflow: visible; \}/, 'the menu may hang below the card');
});

test('a finished game offers Next round (where it applies), Home and New game', () => {
  assert.match(over, /id="home-btn"/);
  assert.match(over, /id="again"/);
  assert.match(over, /id="fresh"/);
  // Home goes to the start screen, New game to the set-up of the same kind of game
  assert.match(over, /\$\('#home-btn'\)\.onclick = \(\) => \{\s*stopFollowing\(\);\s*showStart\(\);/);
  assert.match(over, /showSetup\(\)/);
  assert.match(over, /resetToHome\(\);\s*return openMultiplayer\(\);/, 'online: back to Multiplayer');
});
