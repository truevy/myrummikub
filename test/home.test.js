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

const setupSrc = ui.slice(ui.indexOf('function showSetup()'), ui.indexOf('$(\'#setup-back\').onclick'));

test('the set-up screen is who plays and how well; the options are in a ☰ menu', () => {
  assert.match(setupSrc, /id="setup-more"/);
  assert.match(setupSrc, /id="setup-menu"/);
  const menu = setupSrc.slice(setupSrc.indexOf('id="setup-menu"'), setupSrc.indexOf('class="setup-main"'));
  for (const part of ['settingsFormHtml()', 'endFirstHtml()', 'id="open-roster"', 'class="odds"']) assert.ok(menu.includes(part), `${part} is in the menu`);
  const main = setupSrc.slice(setupSrc.indexOf('class="setup-main"'));
  for (const part of ['class="steppers"', 'id="names"', 'id="ai-levels"', 'id="start"', 'id="setup-back"']) assert.ok(main.includes(part), `${part} stays on the screen`);
  for (const gone of ['settingsFormHtml()', 'endFirstHtml()', 'class="odds"', 'setup-cols']) assert.ok(!main.includes(gone), `${gone} is not on the screen itself`);
  assert.match(setupSrc, /'wide start'/);
});

test('coming back to an online game: the moves scroll in their own frame and the button stays in view', () => {
  const summary = ui.slice(ui.indexOf('function showGameSummary'), ui.indexOf('// A finished online game goes into this device'));
  assert.match(summary, /moves-frame/);
  assert.match(summary, /'summary'/);
  assert.match(summary, /id="summary-go"/);
  assert.match(css, /\.card\.summary \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;/);
  assert.match(css, /\.card\.summary \.moves-frame \{[^}]*flex: 1 1 auto;[^}]*overflow-y: auto;/);
  assert.match(css, /\.card\.summary \.actions \{ flex: none; \}/, 'the button never scrolls away');
});

test('the 🌐 button in a game opens the Multiplayer screen, and Back returns to the game', () => {
  assert.match(ui, /\$\('#btn-online'\)\.addEventListener\('click', openMultiplayer\)/);
  const open = ui.slice(ui.indexOf('async function openMultiplayer()'), ui.indexOf('// How many players have registered'));
  assert.match(open, /parkLocalGame\(\)/, 'a game on this computer steps aside');
  assert.match(open, /kind: 'online'/, 'an online game stays open behind it');
  assert.match(open, /resumeParked\(\)/, 'Back resumes the saved game');
  assert.match(ui, /textContent = '← Back to your game'/);
  assert.doesNotMatch(open, /return showOnlineHome\(\)/, 'no old Online page in the way');
  assert.match(ui, /function enterOnlineGame\(meta, g, appliedRev\) \{\s*multiFrom = null;/, 'starting an online game ends the switch');
});
