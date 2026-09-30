const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/lobby.js');
const P = require('../src/profiles.js');

test('records read from the database are tidied, not trusted', () => {
  assert.strictEqual(L.cleanPlayerRecord(null), null);
  assert.strictEqual(L.cleanPlayerRecord({ name: 'Sara' }), null, 'needs a device');
  const p = L.cleanPlayerRecord({ device: 'dev1', name: 'Sara', face: '🦄', photo: 'javascript:alert(1)', updatedAt: -5 });
  assert.deepStrictEqual(p, { device: 'dev1', name: 'Sara', face: '🦄', photo: null, updatedAt: 0 });
  assert.deepStrictEqual(L.cleanPresence(undefined), { online: false, game: null, at: 0 });
  assert.deepStrictEqual(L.cleanPresence({ online: 'yes', game: 'nope', at: 12 }), { online: false, game: null, at: 12 });
  assert.deepStrictEqual(L.cleanPresence({ online: true, game: 'abcdef0123456789', at: 12 }), { online: true, game: 'abcdef0123456789', at: 12 });
  assert.deepStrictEqual(L.cleanFriendRecord({}), { name: '?', face: '🙂', since: 0 });
});

test('friends are summarised as online, playing and offline', () => {
  const friends = [
    { pid: 'a', name: 'Zoe', face: '🐸', presence: { online: true, game: null, at: 1 } },
    { pid: 'b', name: 'Max', face: '🐻', presence: { online: true, game: 'abcdef0123456789', at: 1 } },
    { pid: 'c', name: 'Ann', face: '🦉', presence: { online: false, game: null, at: 1 } },
    { pid: 'd', name: 'Bob', face: '🦁', presence: { online: true, game: null, at: 1 } },
  ];
  const s = L.friendsSummary(friends);
  assert.strictEqual(s.online, 3);
  assert.strictEqual(s.playing, 1);
  assert.strictEqual(s.free, 2);
  assert.deepStrictEqual(s.list.map((f) => f.name + ':' + f.state), ['Bob:online', 'Zoe:online', 'Max:playing', 'Ann:offline']);
  assert.strictEqual(L.summaryText(s), '3 friends online, 1 playing right now');
  assert.strictEqual(L.summaryText(L.friendsSummary([])), 'No friends yet');
  assert.strictEqual(L.summaryText(L.friendsSummary([friends[2]])), 'No friends online');
  assert.strictEqual(L.summaryText(L.friendsSummary([friends[0]])), '1 friend online');
});

test('the online flag on a profile is kept and cleaned', () => {
  const db = P.emptyDb();
  const sara = P.saveProfile(db, { name: 'Sara', cloud: true });
  const max = P.saveProfile(db, { name: 'Max', cloud: 'yes' });
  assert.strictEqual(sara.cloud, true);
  assert.strictEqual(max.cloud, false, 'only a real true counts');
  assert.deepStrictEqual(P.cloudProfiles(db).map((p) => p.name), ['Sara']);
  const again = P.cleanDb(JSON.parse(JSON.stringify(db)));
  assert.deepStrictEqual(again.profiles.map((p) => p.cloud), [true, false]);
});

test('invitation links and messages', () => {
  const link = L.buildJoinLink('lyndas-rummikub', 'abcdef0123456789');
  assert.strictEqual(link, 'lyndas-rummikub://join?t=abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl(link, 'lyndas-rummikub'), 'abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl('  ' + link.toUpperCase() + ' ', 'lyndas-rummikub'), 'abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl('https://evil.example/join?t=abcdef0123456789', 'lyndas-rummikub'), null);
  assert.strictEqual(L.parseJoinUrl('lyndas-rummikub://join?t=../../x', 'lyndas-rummikub'), null);
  assert.strictEqual(L.parseJoinUrl(null, 'lyndas-rummikub'), null);
  const text = L.inviteMessage({ hostName: 'Tina', link, releasesUrl: 'https://github.com/x/releases' });
  assert.match(text, /Tina invites you/);
  assert.ok(text.includes(link) && text.includes('https://github.com/x/releases'));
  assert.ok(L.smsUrl('+15550102030', 'a b').startsWith('sms:+15550102030&body=a%20b'));
  assert.ok(L.mailtoUrl('a@b.co', 'hi', 'Sub').startsWith('mailto:a@b.co?subject=Sub&body=hi'));
  assert.ok(L.smsUrl('', 'x').startsWith('sms:&body='), 'no recipient is allowed');
});

test('invitation records and their status', () => {
  const from = { pid: 'abcdef0123456789', device: 'dev1', name: 'Tina', face: '🦄' };
  const base = { game: 'abcdef0123456780', seat: 2, from, createdAt: 1000 };
  assert.strictEqual(L.cleanInvite({ ...base, seat: 7 }), null, 'seat must be 0-3');
  const inv = L.cleanInvite(base);
  assert.strictEqual(inv.seat, '2', 'seat index is kept as a string for the rules');
  assert.strictEqual(L.inviteStatus(inv, null, 2000, 86400000), 'sent');
  assert.strictEqual(L.inviteStatus(inv, null, 1000 + 86400001, 86400000), 'expired');
  const claimed = L.cleanInvite({ ...base, claimed: { device: 'dev2', pid: null, status: 'registering', at: 5 } });
  assert.strictEqual(L.inviteStatus(claimed, null, 2000, 86400000), 'registering');
  const seat = L.cleanSeat({ pid: 'abcdef0123456781', device: 'dev2', name: 'Sara', face: '🐸', token: 'abcdef0123456799', status: 'ready', at: 9 });
  assert.strictEqual(L.inviteStatus(claimed, { ...seat, status: 'joining' }, 2000, 86400000), 'joining');
  assert.strictEqual(L.inviteStatus(claimed, seat, 2000, 86400000), 'ready');
  const later = L.cleanInvite({ ...base, answer: { kind: 'later', minutes: 10, at: 60000 } });
  assert.strictEqual(L.inviteStatus(later, null, 2000, 86400000), 'later');
  assert.strictEqual(L.laterUntil(later), 660000);
  assert.strictEqual(L.cleanInvite({ ...base, answer: { kind: 'later', minutes: 99 } }).answer.minutes, 10);
  assert.strictEqual(L.inviteStatus(L.cleanInvite({ ...base, answer: { kind: 'decline' } }), null, 0, 0), 'declined');
  assert.strictEqual(L.inviteStatus(L.cleanInvite({ ...base, revoked: true }), null, 0, 0), 'removed');
  assert.strictEqual(L.statusText('registering'), 'Pending registration');
});

test('a lobby can start with 2–4 ready seats and hands out free seats', () => {
  const s = (status) => ({ pid: 'abcdef0123456789', device: 'd', name: 'x', face: 'y', token: null, status, at: 0 });
  assert.ok(!L.canStart({ 0: s('ready') }));
  assert.ok(L.canStart({ 0: s('ready'), 1: s('ready') }));
  assert.ok(!L.canStart({ 0: s('ready'), 1: s('joining') }));
  assert.ok(!L.canStart({ 0: s('ready'), 1: s('ready'), 2: s('ready'), 3: s('ready'), 4: s('ready') }));
  const inv = (seat, extra = {}) => L.cleanInvite({ game: 'abcdef0123456780', seat, from: { pid: 'abcdef0123456789', device: 'd', name: 'T', face: 'f' }, createdAt: 1, ...extra });
  assert.strictEqual(L.freeSeat({ 0: s('ready') }, [inv(1)]), '2');
  assert.strictEqual(L.freeSeat({ 0: s('ready') }, [inv(1, { answer: { kind: 'decline' } })]), '1', 'a declined invite frees its seat');
  assert.strictEqual(L.freeSeat({ 0: s('ready'), 1: s('ready'), 2: s('ready'), 3: s('ready') }, []), null);
  assert.strictEqual(L.fmtElapsed(65000), '1:05');
  const meta = L.cleanMeta({ host: 'abcdef0123456789', hostDevice: 'd', phase: 'playing', players: { 0: { pid: 'abcdef0123456789', device: 'd', name: 'T', face: 'f' } }, devices: { d: true }, start: { draws: { 0: 5, 1: 77 }, current: 1 } });
  assert.deepStrictEqual(meta.start, { draws: [5, 77], current: 1 });
  assert.deepStrictEqual(meta.devices, ['d']);
  assert.strictEqual(meta.players.length, 1);
});
