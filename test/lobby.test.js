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
  const link = L.buildJoinLink('rummi-tummi', 'abcdef0123456789');
  assert.strictEqual(link, 'rummi-tummi://join?t=abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl(link, 'rummi-tummi'), 'abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl('  ' + link.toUpperCase() + ' ', 'rummi-tummi'), 'abcdef0123456789');
  assert.strictEqual(L.parseJoinUrl('https://evil.example/join?t=abcdef0123456789', 'rummi-tummi'), null);
  assert.strictEqual(L.parseJoinUrl('rummi-tummi://join?t=../../x', 'rummi-tummi'), null);
  assert.strictEqual(L.parseJoinUrl(null, 'rummi-tummi'), null);
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
  assert.strictEqual(meta.round, 1, 'a game without a round is the first');
  assert.strictEqual(meta.next, null);
  const later = L.cleanMeta({ host: 'abcdef0123456789', hostDevice: 'd', round: 3, next: 'fedcba9876543210' });
  assert.strictEqual(later.round, 3);
  assert.strictEqual(later.next, 'fedcba9876543210');
  assert.strictEqual(L.cleanMeta({ host: 'abcdef0123456789', hostDevice: 'd', round: -2, next: '../x' }).next, null);
});

test('when a recent player was last available', () => {
  const now = 10 * 24 * 3600e3;
  const off = (ago) => ({ online: false, game: null, at: now - ago });
  assert.strictEqual(L.lastAvailableText({ online: true, game: null, at: 1 }, now), 'Available now');
  assert.strictEqual(L.lastAvailableText({ online: true, game: 'g', at: 1 }, now), 'Playing now');
  assert.strictEqual(L.lastAvailableText(null, now), 'Not seen online yet');
  assert.strictEqual(L.lastAvailableText(off(20e3), now), 'Last available just now');
  assert.strictEqual(L.lastAvailableText(off(60e3), now), 'Last available 1 minute ago');
  assert.strictEqual(L.lastAvailableText(off(3 * 3600e3), now), 'Last available 3 hours ago');
  assert.strictEqual(L.lastAvailableText(off(2 * 24 * 3600e3), now), 'Last available 2 days ago');
  assert.match(L.lastAvailableText(off(now - 1000), now + 40 * 24 * 3600e3), /^Last available on /);
  const list = L.friendsSummary([
    { pid: 'a', name: 'Ann', presence: off(5 * 3600e3) },
    { pid: 'b', name: 'Zoe', presence: off(60e3) },
  ]).list;
  assert.deepStrictEqual(list.map((f) => f.name), ['Zoe', 'Ann'], 'most recently seen first');
});

test('names are compared without case or stray spaces', () => {
  assert.strictEqual(L.nameKey(' Sara '), L.nameKey('sara'));
  assert.strictEqual(L.nameKey('Mary  Jo'), L.nameKey('mary jo'));
  assert.notStrictEqual(L.nameKey('Sara'), L.nameKey('Sarah'));
  assert.ok(!/[.$#\[\]\/]/.test(L.nameKey('a.b/c#d$e[f]')), 'safe as a database key');
  assert.strictEqual(L.nameKey('   '), '');
});

test('rankings: most wins first, ties share a rank', () => {
  const id = (c) => c.repeat(16);
  const rows = [
    L.cleanRanking(id('a'), { name: 'Ann', face: '🦉', games: 10, wins: 4, at: 5 }),
    L.cleanRanking(id('b'), { name: 'Bob', face: '🦁', games: 5, wins: 4, at: 1 }),
    L.cleanRanking(id('c'), { name: 'Cat', face: '🐼', games: 3, wins: 9, at: 1 }),
    L.cleanRanking(id('d'), { name: 'Dee', face: '🐸', games: 5, wins: 4, at: 9 }),
    L.cleanRanking(id('e'), { name: 'Eve', games: 0, wins: 0 }),
    L.cleanRanking('bad id', { name: 'X', games: 1, wins: 1 }),
  ].filter(Boolean);
  assert.strictEqual(rows.length, 4, 'no games and bad ids are dropped');
  assert.strictEqual(rows[2].wins, 3, 'wins can never exceed games');
  const ranked = L.rankPlayers(rows);
  assert.deepStrictEqual(ranked.map((r) => r.name + ':' + r.rank), ['Dee:1', 'Bob:1', 'Ann:3', 'Cat:4']);
});

test('a game can start without waiting for the people invited', () => {
  const ready = (name) => ({ pid: name.repeat(16).slice(0, 16), device: 'd1', name, face: '🙂', token: null, status: 'ready', at: 0 });
  const seats = { 0: ready('a'), 1: ready('b') };
  const inv = { token: 't', game: 'g', seat: '2', createdAt: 1000, revoked: false };
  assert.ok(L.canStart(seats, []));
  assert.ok(L.canStart(seats, [inv]), 'an open invitation does not hold the start');
  assert.ok(L.canStart({ 0: ready('a') }, [inv]), 'one seated and one invited make two players');
  assert.ok(!L.canStart({ 0: ready('a') }, []), 'alone is not a game');
  assert.ok(!L.canStart({ 0: { ...ready('a'), status: 'joining' }, 1: ready('b') }, []), 'someone at the table is not ready yet');
  assert.ok(!L.canStart(seats, [inv, inv, inv]), 'never more than four');
});

test('absent seats, and how long a game with one lasts', () => {
  const friend = { pid: 'f'.repeat(16), name: 'Max', face: '🦁' };
  const a = L.absentPerson({ token: 'a'.repeat(16) }, '2', friend);
  assert.strictEqual(a.name, 'Max');
  assert.ok(L.isAbsent(a));
  const guest = L.absentPerson({ token: 'b'.repeat(16) }, '3', null);
  assert.strictEqual(guest.name, 'Guest 4');
  assert.strictEqual(guest.pid, 'b'.repeat(16));
  assert.ok(L.cleanPerson(guest), 'an absent seat is a valid person record');
  const meta = { phase: 'playing', startedAt: 5000, createdAt: 1000, players: [a, { pid: 'c'.repeat(16), device: 'd1', name: 'Ann', face: '🙂' }] };
  assert.strictEqual(L.expiresAt(meta), 5000 + L.ABSENT_GAME_MS);
  assert.strictEqual(L.expiresAt({ ...meta, players: [meta.players[1]] }), 0, 'everyone present: no end date');
  assert.strictEqual(L.expiresAt({ ...meta, phase: 'lobby' }), 0);
  assert.strictEqual(L.fmtAgo(30000), 'just now');
  assert.strictEqual(L.fmtAgo(5 * 60000), '5 min ago');
  assert.strictEqual(L.fmtAgo(3 * 3600e3), '3 h ago');
  assert.strictEqual(L.fmtAgo(50 * 3600e3), '2 d ago');
  assert.strictEqual(L.cleanGameName('  Friday   night  '), 'Friday night');
  assert.match(L.inviteMessage({ hostName: 'Tina', link: 'x://y', releasesUrl: 'r', gameName: 'Friday night' }), /“Friday night”/);
});

test('a sign-in link carries the browser result back to the app', () => {
  const cred = JSON.stringify({ providerId: 'apple.com', signInMethod: 'apple.com', idToken: 'x.y.z' });
  const c = encodeURIComponent(Buffer.from(cred, 'utf8').toString('base64'));
  const got = L.parseAuthUrl(`rummi-tummi://auth?provider=apple&c=${c}&name=Tom%20Rue`, 'rummi-tummi');
  assert.deepStrictEqual(got, { provider: 'apple', credential: cred, name: 'Tom Rue', state: '' });
  assert.deepStrictEqual(L.parseAuthUrl(`rummi-tummi://auth?c=${c}`, 'rummi-tummi'), { provider: 'apple', credential: cred, name: '', state: '' }, 'Apple is the default');
  const state = '0123456789abcdef0123456789abcdef';
  assert.strictEqual(L.parseAuthUrl(`rummi-tummi://auth?provider=apple&c=${c}&state=${state}`, 'rummi-tummi').state, state, 'the one-time value comes back');
  assert.strictEqual(L.parseAuthUrl(`rummi-tummi://auth?error=Cancelled&state=${state}`, 'rummi-tummi').state, state);
  assert.strictEqual(L.parseAuthUrl(`rummi-tummi://auth?c=${c}&state=<b>`, 'rummi-tummi').state, '', 'anything else is no value at all');
  assert.strictEqual(L.parseAuthUrl(`rummi-tummi://auth?provider=google&c=${c}`, 'rummi-tummi').error, 'Only Sign in with Apple is supported.');
  assert.strictEqual(L.parseAuthUrl('rummi-tummi://auth?error=Cancelled', 'rummi-tummi').error, 'Cancelled');
  assert.strictEqual(L.parseAuthUrl('rummi-tummi://auth?provider=apple&c=%%%', 'rummi-tummi').error, 'The sign-in link is damaged.');
  assert.strictEqual(L.parseAuthUrl('rummi-tummi://join?t=abcdef0123456789', 'rummi-tummi'), null, 'an invitation is not a sign-in');
  assert.strictEqual(L.parseAuthUrl('https://evil.example/auth?provider=apple', 'rummi-tummi'), null);
});
