// Checks chat, unique names and rankings against the live database with
// three throwaway anonymous devices, then removes everything it wrote.
// Run it after publishing database.rules.json:
//
//   node scripts/check-online.js
const ROOT = require('path').join(__dirname, '..') + '/';
const { initializeApp } = require(ROOT + 'node_modules/firebase/app');
const { getAuth, signInAnonymously } = require(ROOT + 'node_modules/firebase/auth');
const { getDatabase, ref, set, update, push, get, remove, onChildAdded, serverTimestamp, query, orderByChild, limitToLast } = require(ROOT + 'node_modules/firebase/database');
globalThis.self = globalThis;
require(ROOT + 'src/config.js');
const { newId } = require(ROOT + 'src/engine.js');
const L = require(ROOT + 'src/lobby.js');
const cfg = (globalThis.RK || self.RK).CLOUD.firebase || (globalThis.RK || self.RK).CLOUD;

const results = [];
const ok = (name, pass, extra = '') => { results.push(pass); console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  — ' + extra : '')); };
const denied = async (name, p) => { try { await p; ok(name, false, 'was allowed'); } catch (e) { ok(name, /permission/i.test(String(e.code || e.message)), String(e.code || e.message)); } };
const allowed = async (name, p) => { try { const r = await p; ok(name, true); return r; } catch (e) { ok(name, false, String(e.code || e.message)); } };

(async () => {
  const dev = async (n) => { const app = initializeApp(cfg, n); const { user } = await signInAnonymously(getAuth(app)); return { db: getDatabase(app), uid: user.uid, pid: newId() }; };
  const [A, B, C] = [await dev('a'), await dev('b'), await dev('c')];
  const gid = newId();
  const gidC = newId();
  const [tok1, tok2, tok3, tokC] = [newId(), newId(), newId(), newId()];
  const tag = Date.now().toString(36).slice(-5);
  const nameA = 'Zt' + tag + 'a', nameB = 'Zt' + tag + 'b';
  try {
    await allowed('host registers a player', set(ref(A.db, 'players/' + A.pid), { device: A.uid, name: nameA, face: '🙂', updatedAt: serverTimestamp() }));
    await allowed('guest registers a player', set(ref(B.db, 'players/' + B.pid), { device: B.uid, name: nameB, face: '🙂', updatedAt: serverTimestamp() }));

    // ---- unique names
    await allowed('host claims their name', set(ref(A.db, 'names/' + L.nameKey(nameA)), A.pid));
    await denied('guest cannot take the host\'s name', set(ref(B.db, 'names/' + L.nameKey(nameA.toUpperCase())), B.pid));
    const owner = await get(ref(B.db, 'names/' + L.nameKey(' ' + nameA + ' ')));
    ok('guest sees who holds the name', owner.val() === A.pid);

    // ---- a game with both devices in it
    await allowed('host creates the game', set(ref(A.db, `games/${gid}/meta`), { host: A.pid, hostDevice: A.uid, createdAt: serverTimestamp(), phase: 'lobby' }));
    await allowed('host starts it with both devices', update(ref(A.db, `games/${gid}/meta`), { devices: { [A.uid]: true, [B.uid]: true }, phase: 'playing' }));

    // ---- invitations and seats
    const inviteFrom = (D) => ({ pid: D.pid, device: D.uid, name: 'x', face: '🙂' });
    const seatOf = (D, token) => ({ pid: D.pid, device: D.uid, name: 'x', face: '🙂', token, status: 'ready', at: serverTimestamp() });
    const invite = (D, game, seat) => ({ game, seat, from: inviteFrom(D), to: null, createdAt: serverTimestamp(), revoked: false });
    await allowed('host invites the guest to seat 1', set(ref(A.db, 'invites/' + tok1), invite(A, gid, '1')));
    await allowed('guest claims the invitation', set(ref(B.db, `invites/${tok1}/claimed`), { device: B.uid, pid: B.pid, status: 'joining', at: serverTimestamp() }));
    await allowed('guest takes seat 1 with it', set(ref(B.db, `games/${gid}/seats/1`), seatOf(B, tok1)));
    await denied('an outsider cannot invite into a game they do not host', set(ref(C.db, 'invites/' + tokC), invite(C, gid, '2')));
    await allowed('an outsider invites into their own game', set(ref(C.db, `games/${gidC}/meta`), { host: C.pid, hostDevice: C.uid, createdAt: serverTimestamp(), phase: 'lobby' }).then(() => set(ref(C.db, 'invites/' + tokC), invite(C, gidC, '1'))));
    await denied('an invitation cannot be pointed at another game', set(ref(C.db, `invites/${tokC}/game`), gid));
    await allowed('host invites seat 1 again', set(ref(A.db, 'invites/' + tok2), invite(A, gid, '1')));
    await allowed('outsider claims that invitation', set(ref(C.db, `invites/${tok2}/claimed`), { device: C.uid, pid: C.pid, status: 'joining', at: serverTimestamp() }));
    await denied('an invitation cannot take a seat someone holds', set(ref(C.db, `games/${gid}/seats/1`), seatOf(C, tok2)));
    await allowed('host revokes it', set(ref(A.db, `invites/${tok2}/revoked`), true).then(() => set(ref(A.db, `invites/${tok2}/seat`), '2')));
    await denied('a revoked invitation cannot take a seat', set(ref(C.db, `games/${gid}/seats/2`), seatOf(C, tok2)));
    await denied('an invitation with a long name is refused', set(ref(A.db, 'invites/' + tok3), { ...invite(A, gid, '2'), from: { ...inviteFrom(A), name: 'x'.repeat(200) } }));
    await allowed('host invites the guest\'s player by name', set(ref(A.db, 'invites/' + tok3), { ...invite(A, gid, '2'), to: B.pid }));
    await denied('an inbox item must name the invitation\'s game', set(ref(A.db, `inbox/${B.pid}/${tok3}`), { game: gidC, from: inviteFrom(A), at: serverTimestamp() }));
    await allowed('the invitation lands in the guest\'s inbox', set(ref(A.db, `inbox/${B.pid}/${tok3}`), { game: gid, from: inviteFrom(A), at: serverTimestamp() }));

    // ---- who plays, and who may move
    const asPerson = (D, pid = D.pid) => ({ pid, device: D.uid, name: 'x', face: '🙂' });
    await denied('the host cannot list a player under someone else\'s account', update(ref(A.db, `games/${gid}/meta`), { players: { 0: asPerson(A), 1: asPerson(B, A.pid) } }));
    await allowed('the host lists both players', update(ref(A.db, `games/${gid}/meta`), { players: { 0: asPerson(A), 1: asPerson(B) } }));
    await denied('a guest cannot pose as another player', set(ref(B.db, `games/${gid}/meta/players/1`), asPerson(B, A.pid)));
    await allowed('a guest lists themselves', set(ref(B.db, `games/${gid}/meta/players/1`), asPerson(B)));
    await allowed('host publishes the first state', set(ref(A.db, `games/${gid}/state`), { rev: 0, by: A.uid, current: 0, skipped: false, at: serverTimestamp(), json: '{}' }));
    await denied('while the mover is away, others cannot play their turn', set(ref(B.db, `games/${gid}/state`), { rev: 1, by: B.uid, current: 1, skipped: false, at: serverTimestamp(), json: '{}' }));
    await allowed('while the mover is away, others may skip it', set(ref(B.db, `games/${gid}/state`), { rev: 1, by: B.uid, current: 1, skipped: true, at: serverTimestamp(), json: '{}' }));

    // ---- chat
    const got = { A: [], B: [] };
    const offA = onChildAdded(ref(A.db, `games/${gid}/chat`), (s) => got.A.push(L.cleanChat(s.val())));
    const offB = onChildAdded(ref(B.db, `games/${gid}/chat`), (s) => got.B.push(L.cleanChat(s.val())));
    await allowed('host sends a message', push(ref(A.db, `games/${gid}/chat`), { device: A.uid, pid: A.pid, name: nameA, text: 'Hello from the host', at: serverTimestamp() }));
    await allowed('guest replies', push(ref(B.db, `games/${gid}/chat`), { device: B.uid, pid: B.pid, name: nameB, text: 'Hi back', at: serverTimestamp() }));
    await new Promise((r) => setTimeout(r, 2500));
    ok('guest receives both messages, in order', got.B.length === 2 && got.B[0].text === 'Hello from the host' && got.B[1].text === 'Hi back', JSON.stringify(got.B.map((m) => m && m.text)));
    ok('host receives both messages, in order', got.A.length === 2 && got.A[1].text === 'Hi back' && got.A[1].name === nameB);
    ok('messages carry a server time', got.A.every((m) => m.at > 1e12));
    await denied('an outsider cannot read the chat', get(ref(C.db, `games/${gid}/chat`)));
    await denied('an outsider cannot write to the chat', push(ref(C.db, `games/${gid}/chat`), { device: C.uid, pid: C.pid, name: 'x', text: 'spam', at: serverTimestamp() }));
    await denied('nobody can post as another device', push(ref(B.db, `games/${gid}/chat`), { device: A.uid, pid: A.pid, name: nameA, text: 'forged', at: serverTimestamp() }));
    await denied('an empty message is refused', push(ref(B.db, `games/${gid}/chat`), { device: B.uid, pid: B.pid, name: nameB, text: '', at: serverTimestamp() }));
    await denied('a message over 300 characters is refused', push(ref(B.db, `games/${gid}/chat`), { device: B.uid, pid: B.pid, name: nameB, text: 'x'.repeat(301), at: serverTimestamp() }));
    offA(); offB();

    // ---- rankings
    await allowed('host records a result', set(ref(A.db, 'rankings/' + A.pid), { name: nameA, face: '🙂', games: 1, wins: 1, at: serverTimestamp() }));
    await denied('guest cannot change the host\'s ranking', set(ref(B.db, 'rankings/' + A.pid), { name: nameA, face: '🙂', games: 9, wins: 9, at: serverTimestamp() }));
    await denied('more wins than games is refused', set(ref(A.db, 'rankings/' + A.pid), { name: nameA, face: '🙂', games: 1, wins: 5, at: serverTimestamp() }));
    const table = await allowed('guest reads the rankings table', get(query(ref(B.db, 'rankings'), orderByChild('wins'), limitToLast(200))));
    ok('the host is in the table', !!table && table.child(A.pid).exists());
  } finally {
    // ---- tidy up everything this check wrote
    const quiet = (p) => p.catch((e) => console.log('cleanup:', e.code || e.message));
    await quiet(remove(ref(B.db, `inbox/${B.pid}/${tok3}`)));
    for (const t of [tok1, tok2, tok3]) await quiet(remove(ref(A.db, 'invites/' + t)));
    await quiet(remove(ref(C.db, 'invites/' + tokC)));
    await quiet(remove(ref(C.db, 'games/' + gidC)));
    await quiet(remove(ref(A.db, 'games/' + gid)));
    await quiet(remove(ref(A.db, 'rankings/' + A.pid)));
    await quiet(remove(ref(A.db, 'names/' + L.nameKey(nameA))));
    await quiet(remove(ref(A.db, 'players/' + A.pid)));
    await quiet(remove(ref(B.db, 'players/' + B.pid)));
    const left = await Promise.all([get(ref(A.db, 'players/' + A.pid)), get(ref(B.db, 'players/' + B.pid)), get(ref(A.db, 'names/' + L.nameKey(nameA))), get(ref(A.db, 'rankings/' + A.pid))]);
    ok('test data removed', left.every((s) => !s.exists()));
    console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
