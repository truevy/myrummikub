// Everything that talks to Firebase. Browser only. Each function returns a
// promise, and every watch* function returns a function that stops watching.
(function (root) {
  const L = root.RK.lobby;
  const cfg = () => root.RK.CLOUD || {};

  let db = null;
  let uid = null;
  let ready = null;
  let offset = 0; // server clock minus ours, milliseconds
  const errorHandlers = [];

  const F = () => root.firebase;
  const TS = () => F().database.ServerValue.TIMESTAMP;

  const configured = () => {
    const f = cfg().firebase || {};
    return !!(f.apiKey && f.databaseURL && f.projectId && f.appId);
  };

  function fail(err) {
    errorHandlers.forEach((h) => h(err));
    throw err;
  }

  // Signs this computer in anonymously (once) and resolves to its device id.
  function init() {
    if (ready) return ready;
    if (!F()) return (ready = Promise.reject(new Error('The Firebase library did not load.')));
    if (!configured()) return (ready = Promise.reject(new Error('Online play is not set up yet — see docs/online.md.')));
    const f = cfg().firebase;
    F().initializeApp({ apiKey: f.apiKey, authDomain: f.authDomain, databaseURL: f.databaseURL, projectId: f.projectId, appId: f.appId });
    db = F().database();
    // Always talk over a WebSocket. Left to itself the library remembers one
    // failed connection and tries "long polling" from then on, which loads
    // scripts from the database's address; the page does not allow that, so
    // the app would then never connect again.
    try {
      db.INTERNAL.forceWebSockets();
    } catch (err) {
      // a library without the switch: nothing to force
    }
    db.ref('.info/serverTimeOffset').on('value', (s) => (offset = s.val() || 0));
    // Whoever is already signed in on this device stays signed in: an account
    // that has been given a sign-in of its own (to play on several devices)
    // must not be replaced by a fresh anonymous one. Only a device with
    // nobody signed in starts anonymously.
    ready = new Promise((resolve, reject) => {
      const auth = F().auth();
      const off = auth.onAuthStateChanged((user) => {
        off();
        if (user) {
          uid = user.uid;
          return resolve(uid);
        }
        auth.signInAnonymously().then((cred) => {
          uid = cred.user.uid;
          resolve(uid);
        }, reject);
      }, reject);
    });
    return ready;
  }

  const serverNow = () => Date.now() + offset;
  const deviceId = () => uid;

  // ---- players and presence ---------------------------------------------------

  // Publishes one of this computer's players so friends can see them.
  async function publishPlayer(profile) {
    await init();
    const record = { device: uid, name: profile.name, face: profile.face, updatedAt: TS() };
    if (profile.photo && profile.photo.length < 64000) record.photo = profile.photo;
    await db.ref('players/' + profile.id).set(record).catch(fail);
    // the account's own list of its players, for its other devices
    return db.ref(`accounts/${uid}/players/${profile.id}`).set(true).catch(() => {});
  }

  // ---- one account on several devices -----------------------------------------
  //
  // A device signs in anonymously. To play from a second device, the account
  // is given a sign-in of its own (a made-up address and a long random key,
  // never shown), and a short code that is good for ten minutes lets the
  // other device fetch them and sign in as the same account. Everything the
  // account owns (players, games, rankings) is then on both devices.

  const SID = root.RK.newId(); // this running copy of the app, to tell its own writes from another device's
  const LINK_TTL_MS = 10 * 60 * 1000;
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randomString(len, alphabet) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  }

  // The account's sign-in, created the first time it is needed.
  async function accountKey() {
    await init();
    const snap = await db.ref(`accounts/${uid}/key`).get().catch(() => null);
    const have = snap && snap.val();
    if (have && have.email && have.secret) return have;
    const user = F().auth().currentUser;
    const secret = randomString(32, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    let key = null;
    for (const domain of ['players.rummitime.invalid', 'example.com']) {
      const email = `p${uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}@${domain}`;
      try {
        await user.linkWithCredential(F().auth.EmailAuthProvider.credential(email, secret));
        key = { email, secret };
        break;
      } catch (err) {
        if (err.code === 'auth/operation-not-allowed') throw new Error('Playing on several devices is not switched on yet: enable Email/Password sign-in in the Firebase console (see docs/online.md).');
        if (err.code !== 'auth/invalid-email') throw err;
      }
    }
    if (!key) throw new Error('The account could not be prepared for another device.');
    await db.ref(`accounts/${uid}/key`).set(key).catch(fail);
    return key;
  }

  // A short code another device can use for the next ten minutes.
  async function makeLinkCode() {
    const key = await accountKey();
    const code = randomString(8, CODE_ALPHABET);
    await db.ref('links/' + code).set({ owner: uid, email: key.email, secret: key.secret, at: TS() }).catch(fail);
    return { code, until: serverNow() + LINK_TTL_MS };
  }

  const cleanCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Signs this device in as the account the code belongs to. Resolves to
  // that account's players.
  async function useLinkCode(text) {
    await init();
    const code = cleanCode(text);
    if (code.length !== 8) throw new Error('The code has eight letters and digits.');
    const snap = await db.ref('links/' + code).get().catch(() => null);
    const link = snap && snap.val();
    if (!link || !link.email || !link.secret) throw new Error('That code is not valid, or it is more than ten minutes old.');
    if (link.owner === uid) throw new Error('That code was made on this device.');
    await clearPresence().catch(() => {});
    if (connectedOff) {
      connectedOff();
      connectedOff = null;
    }
    const cred = await F().auth().signInWithEmailAndPassword(link.email, link.secret);
    uid = cred.user.uid;
    ready = Promise.resolve(uid);
    db.ref('links/' + code).remove().catch(() => {});
    // the database learns of the new sign-in a moment later: until then the
    // account's own records read as empty
    let players = [];
    for (let attempt = 0; attempt < 8 && !players.length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500));
      players = await listMyPlayers();
    }
    return players;
  }

  // Ties this device's account to an Apple ID, or switches to the account
  // that Apple ID already has. Resolves to { switched, players }: with
  // switched, the device now plays as that account's players.
  async function signInWithApple({ idToken, nonce }) {
    await init();
    const auth = F().auth();
    const cred = new F().auth.OAuthProvider('apple.com').credential({ idToken, rawNonce: nonce });
    try {
      await auth.currentUser.linkWithCredential(cred);
      return { switched: false, players: [] };
    } catch (err) {
      if (!['auth/credential-already-in-use', 'auth/provider-already-linked', 'auth/email-already-in-use'].includes(err.code)) {
        if (err.code === 'auth/operation-not-allowed') throw new Error('Sign in with Apple is not switched on yet: enable Apple in the Firebase console (see docs/online.md).');
        throw err;
      }
    }
    // this Apple ID already has an account (another device signed in with it)
    await clearPresence().catch(() => {});
    if (connectedOff) {
      connectedOff();
      connectedOff = null;
    }
    const result = await auth.signInWithCredential(cred);
    const switched = result.user.uid !== uid;
    uid = result.user.uid;
    ready = Promise.resolve(uid);
    let players = [];
    for (let attempt = 0; attempt < 8 && !players.length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500));
      players = await listMyPlayers();
    }
    return { switched, players };
  }

  async function listMyPlayers() {
    await init();
    const snap = await db.ref(`accounts/${uid}/players`).get().catch(() => null);
    const out = [];
    for (const pid of Object.keys((snap && snap.val()) || {})) {
      if (!L.isId(pid)) continue;
      const rec = await readPlayer(pid);
      if (rec) out.push({ id: pid, name: rec.name, face: rec.face, photo: rec.photo || null });
    }
    return out;
  }

  async function readPlayer(pid) {
    await init();
    const snap = await db.ref('players/' + pid).get().catch(() => null);
    return snap ? L.cleanPlayerRecord(snap.val()) : null;
  }

  // ---- unique names --------------------------------------------------------------

  // Who holds a name online: a player id, or null when it is free (or the
  // database could not be asked).
  async function nameOwner(name) {
    await init();
    const key = L.nameKey(name);
    if (!key) return null;
    const snap = await db.ref('names/' + key).get().catch(() => null);
    const pid = snap ? snap.val() : null;
    if (!L.isId(pid)) return null;
    // a name left behind by a player who no longer exists is free again
    const owner = await db.ref('players/' + pid + '/device').get().catch(() => null);
    return owner && owner.exists() ? pid : null;
  }

  // Registers the name for this player. true: it is theirs; false: someone
  // else holds it; null: the database did not say.
  async function claimName(name, pid) {
    await init();
    const key = L.nameKey(name);
    if (!key) return null;
    const holder = await nameOwner(name);
    if (holder && holder !== pid) return false;
    try {
      await db.ref('names/' + key).set(pid);
      return true;
    } catch (err) {
      return null;
    }
  }

  async function releaseName(name, pid) {
    await init();
    const key = L.nameKey(name);
    if (!key) return;
    const snap = await db.ref('names/' + key).get().catch(() => null);
    if (snap && snap.val() === pid) await db.ref('names/' + key).remove().catch(() => {});
  }

  // ---- rankings ------------------------------------------------------------------

  // Adds one finished online game to a player's record.
  // Each game counts once, however many of the account's devices report it.
  async function addResult(profile, won, gid) {
    await init();
    return db
      .ref('rankings/' + profile.id)
      .transaction((cur) => {
        const seen = (cur && cur.seen) || {};
        if (gid && seen[gid]) return; // already counted
        const games = ((cur && cur.games) || 0) + 1;
        const wins = Math.min(games, ((cur && cur.wins) || 0) + (won ? 1 : 0));
        const keep = {};
        Object.keys(seen).slice(-40).forEach((k) => (keep[k] = true));
        if (gid) keep[gid] = true;
        return { name: profile.name, face: profile.face, games, wins, seen: keep, at: TS() };
      })
      .catch(() => null);
  }

  async function readRanking(pid) {
    await init();
    const snap = await db.ref('rankings/' + pid).get().catch(() => null);
    return snap ? L.cleanRanking(pid, snap.val()) : null;
  }

  async function readRankings() {
    await init();
    const snap = await db.ref('rankings').orderByChild('wins').limitToLast(200).get();
    const list = [];
    snap.forEach((child) => {
      const r = L.cleanRanking(child.key, child.val());
      if (r) list.push(r);
    });
    return L.rankPlayers(list);
  }

  async function removePlayer(pid) {
    await init();
    await db.ref('presence/' + pid).remove().catch(fail);
    db.ref(`accounts/${uid}/players/${pid}`).remove().catch(() => {});
    return db.ref('players/' + pid).remove().catch(fail);
  }

  let presencePids = [];
  let presenceGame = null;
  let connectedOff = null;

  // Marks these players online (and in a game, if given). Re-applied on every
  // reconnect; the database marks them offline by itself when we vanish.
  async function setPresence(pids, game = null) {
    await init();
    presencePids = pids.slice();
    presenceGame = game;
    const apply = async () => {
      for (const pid of presencePids) {
        const ref = db.ref('presence/' + pid);
        await ref.onDisconnect().set({ online: false, game: null, at: TS() });
        await ref.set({ online: true, game: presenceGame, at: TS() });
      }
    };
    if (!connectedOff) {
      const ref = db.ref('.info/connected');
      const handler = (snap) => {
        if (snap.val() === true) apply().catch((err) => errorHandlers.forEach((h) => h(err)));
      };
      ref.on('value', handler);
      connectedOff = () => ref.off('value', handler);
    }
    return apply().catch(fail);
  }

  async function clearPresence() {
    await init();
    for (const pid of presencePids) {
      const ref = db.ref('presence/' + pid);
      await ref.onDisconnect().cancel();
      await ref.set({ online: false, game: null, at: TS() }).catch(() => {});
    }
    presencePids = [];
  }

  function watchConnection(cb) {
    const ref = db.ref('.info/connected');
    const handler = (snap) => cb(snap.val() === true);
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }

  // ---- friends -----------------------------------------------------------------

  async function addFriend(myPid, otherPid, { name, face }) {
    await init();
    return db.ref(`friends/${myPid}/${otherPid}`).set({ name, face, since: TS() }).catch(fail);
  }

  // Watches the friends of all of this computer's players and their presence.
  // cb receives [{ pid, name, face, photo, presence, friendOf: [myPid] }].
  function watchFriends(myPids, cb) {
    const friendRecords = new Map(); // otherPid → { name, face, friendOf: Set }
    const players = new Map(); // otherPid → cleaned player record or null
    const presence = new Map(); // otherPid → presence
    const watchers = new Map(); // otherPid → off()
    const edgeOffs = [];

    const emit = () => {
      const list = [];
      for (const [pid, f] of friendRecords) {
        if (myPids.includes(pid)) continue; // people on this computer are not each other's "friends online"
        const p = players.get(pid);
        list.push({
          pid,
          name: p ? p.name : f.name,
          face: p ? p.face : f.face,
          photo: p ? p.photo : null,
          presence: presence.get(pid) || L.cleanPresence(null),
          friendOf: [...f.friendOf],
        });
      }
      cb(list);
    };

    const watchOne = (pid) => {
      if (watchers.has(pid)) return;
      const pr = db.ref('players/' + pid);
      const sr = db.ref('presence/' + pid);
      const ph = (snap) => {
        players.set(pid, L.cleanPlayerRecord(snap.val()));
        emit();
      };
      const sh = (snap) => {
        presence.set(pid, L.cleanPresence(snap.val()));
        emit();
      };
      pr.on('value', ph);
      sr.on('value', sh);
      watchers.set(pid, () => {
        pr.off('value', ph);
        sr.off('value', sh);
      });
    };

    for (const myPid of myPids) {
      const ref = db.ref('friends/' + myPid);
      const handler = (snap) => {
        const val = snap.val() || {};
        // drop edges of this owner that vanished, add the ones that appeared
        for (const [pid, f] of friendRecords) {
          if (!val[pid]) f.friendOf.delete(myPid);
        }
        for (const pid of Object.keys(val)) {
          if (!L.isId(pid)) continue;
          const rec = L.cleanFriendRecord(val[pid]);
          if (!rec) continue;
          const f = friendRecords.get(pid) || { name: rec.name, face: rec.face, friendOf: new Set() };
          f.friendOf.add(myPid);
          friendRecords.set(pid, f);
          watchOne(pid);
        }
        for (const [pid, f] of [...friendRecords]) {
          if (f.friendOf.size === 0) {
            friendRecords.delete(pid);
            const off = watchers.get(pid);
            if (off) off();
            watchers.delete(pid);
          }
        }
        emit();
      };
      ref.on('value', handler);
      edgeOffs.push(() => ref.off('value', handler));
    }
    return () => {
      edgeOffs.forEach((off) => off());
      watchers.forEach((off) => off());
    };
  }

  // ---- invitations and lobbies -------------------------------------------------

  const person = (p) => ({ pid: p.pid, device: p.device, name: p.name, face: p.face });

  // A new game in its lobby phase. Resolves to the game id.
  async function createGame(host, name = '') {
    await init();
    const gid = root.RK.newId();
    await db.ref('games/' + gid + '/meta').set({ host: host.pid, hostDevice: uid, name, createdAt: TS(), phase: 'lobby' }).catch(fail);
    return gid;
  }

  async function nameGame(gid, name) {
    await init();
    return db.ref(`games/${gid}/meta/name`).set(name).catch(fail);
  }

  // Someone invited before the game started takes their seat in it: they
  // add themselves to the players and the devices the game is shared with.
  async function admitSelf(gid, n, me) {
    await init();
    await db.ref(`games/${gid}/meta/players/${n}`).set(person(me)).catch(fail);
    return db.ref(`games/${gid}/meta/devices/${uid}`).set(String(n)).catch(fail);
  }

  // ---- the games this device is part of ---------------------------------------

  async function addMyGame(gid, info) {
    await init();
    return db.ref(`devices/${uid}/games/${gid}`).set({ name: info.name || '', host: info.host === true, at: TS() }).catch(() => {});
  }

  async function removeMyGame(gid) {
    await init();
    return db.ref(`devices/${uid}/games/${gid}`).remove().catch(() => {});
  }

  // cb gets the list of game ids, and again whenever it changes
  function watchMyGames(cb) {
    const ref = db.ref(`devices/${uid}/games`);
    const h = (snap) => {
      const v = snap.val() || {};
      cb(Object.keys(v).filter(L.isId));
    };
    ref.on('value', h);
    return () => ref.off('value', h);
  }

  async function setSeat(gid, n, seat) {
    await init();
    return db.ref(`games/${gid}/seats/${n}`).set({ ...person(seat), token: seat.token || null, status: seat.status || 'joining', at: TS() }).catch(fail);
  }

  async function removeSeat(gid, n) {
    await init();
    return db.ref(`games/${gid}/seats/${n}`).remove().catch(fail);
  }

  // An invitation to one seat. For an online friend it also lands in their
  // inbox; a newcomer gets it as a link. Resolves to the token.
  async function createInvite({ gid, seat, from, toPid }) {
    await init();
    const token = root.RK.newId();
    await db.ref('invites/' + token).set({ game: gid, seat: String(seat), from: person(from), to: toPid || null, createdAt: TS(), revoked: false }).catch(fail);
    if (toPid) await db.ref(`inbox/${toPid}/${token}`).set({ game: gid, from: person(from), at: TS() }).catch(fail);
    return token;
  }

  async function revokeInvite(token, toPid) {
    await init();
    await db.ref('invites/' + token + '/revoked').set(true).catch(fail);
    if (toPid) await db.ref(`inbox/${toPid}/${token}`).remove().catch(() => {});
  }

  async function readInvite(token) {
    await init();
    const snap = await db.ref('invites/' + token).get().catch(fail);
    return L.cleanInvite(snap.val());
  }

  function watchInvite(token, cb) {
    const ref = db.ref('invites/' + token);
    const h = (snap) => cb(L.cleanInvite(snap.val()));
    ref.on('value', h);
    return () => ref.off('value', h);
  }

  // Marks an invitation as being acted on by this computer: received (the link
  // was opened), registering (a new player is being created) or joining.
  async function claimInvite(token, { pid = null, status = 'received' }) {
    await init();
    return db.ref('invites/' + token + '/claimed').set({ device: uid, pid, status, at: TS() }).catch(fail);
  }

  async function answerInvite(token, answer) {
    await init();
    return db.ref('invites/' + token + '/answer').set({ ...answer, at: TS() }).catch(fail);
  }

  async function removeInbox(pid, token) {
    await init();
    return db.ref(`inbox/${pid}/${token}`).remove().catch(() => {});
  }

  // Invitations addressed to this computer's players. cb receives
  // [{ token, pid, game, from, at }].
  function watchInbox(pids, cb) {
    const items = new Map();
    const offs = [];
    const emit = () => cb([...items.values()].sort((a, b) => a.at - b.at));
    for (const pid of pids) {
      const ref = db.ref('inbox/' + pid);
      const h = (snap) => {
        for (const key of [...items.keys()]) if (items.get(key).pid === pid) items.delete(key);
        const val = snap.val() || {};
        for (const token of Object.keys(val)) {
          const from = L.cleanPerson(val[token] && val[token].from);
          if (!L.isId(token) || !from || !L.isId(val[token].game)) continue;
          items.set(pid + ':' + token, { token, pid, game: val[token].game, from, at: Number(val[token].at) || 0 });
        }
        emit();
      };
      ref.on('value', h);
      offs.push(() => ref.off('value', h));
    }
    return () => offs.forEach((off) => off());
  }

  function watchSeats(gid, cb) {
    const ref = db.ref(`games/${gid}/seats`);
    const h = (snap) => {
      const val = snap.val() || {};
      const seats = {};
      for (const n of Object.keys(val)) if (/^[0-3]$/.test(n)) seats[n] = L.cleanSeat(val[n]);
      cb(seats);
    };
    ref.on('value', h);
    return () => ref.off('value', h);
  }

  async function readMeta(gid) {
    await init();
    const snap = await db.ref(`games/${gid}/meta`).get().catch(() => null);
    return snap ? L.cleanMeta(snap.val()) : null;
  }

  // Used invitations are removed once the game has started.
  async function deleteInvite(token) {
    await init();
    return db.ref('invites/' + token).remove().catch(() => {});
  }

  function watchMeta(gid, cb) {
    const ref = db.ref(`games/${gid}/meta`);
    const h = (snap) => cb(L.cleanMeta(snap.val()));
    ref.on('value', h);
    return () => ref.off('value', h);
  }

  // The host turns the lobby into a game: who sits where, which computers
  // take part, the opening draw, and the first state.
  async function startGame(gid, { players, devices, start, stateJson, current, name = '' }) {
    await init();
    const meta = db.ref(`games/${gid}/meta`);
    const dev = {};
    devices.forEach((d) => (dev[d] = true));
    await meta.update({ players: players.map(person), devices: dev, start, name, startedAt: TS(), phase: 'playing' }).catch(fail);
    return db.ref(`games/${gid}/state`).set({ rev: 0, by: uid, current, skipped: false, at: TS(), json: stateJson }).catch(fail);
  }

  // The mover publishes the game after every finished turn. rev must be one
  // more than the record already there; anyone else's stale write is refused.
  async function publishState(gid, record) {
    await init();
    return db.ref(`games/${gid}/state`).set({ ...record, by: uid, sid: SID, at: TS() }).catch(fail);
  }

  async function readState(gid) {
    await init();
    const snap = await db.ref(`games/${gid}/state`).get().catch(fail);
    const v = snap.val();
    if (!v || typeof v.json !== 'string' || !Number.isInteger(v.rev)) return null;
    return { rev: v.rev, by: String(v.by || ''), current: Number(v.current) || 0, skipped: v.skipped === true, at: Number(v.at) || 0, json: v.json };
  }

  // Presence of the given players; cb receives a map pid → presence.
  function watchPresenceOf(pids, cb) {
    const presence = new Map();
    const offs = pids.map((pid) => {
      const ref = db.ref('presence/' + pid);
      const h = (snap) => {
        presence.set(pid, L.cleanPresence(snap.val()));
        cb(new Map(presence));
      };
      ref.on('value', h);
      return () => ref.off('value', h);
    });
    return () => offs.forEach((off) => off());
  }

  function watchState(gid, cb) {
    const ref = db.ref(`games/${gid}/state`);
    const h = (snap) => {
      const v = snap.val();
      if (!v || typeof v.json !== 'string' || !Number.isInteger(v.rev)) return cb(null);
      cb({ rev: v.rev, by: String(v.by || ''), sid: String(v.sid || ''), current: Number(v.current) || 0, skipped: v.skipped === true, at: Number(v.at) || 0, json: v.json });
    };
    ref.on('value', h);
    return () => ref.off('value', h);
  }

  // ---- chat --------------------------------------------------------------------

  async function sendChat(gid, { pid, name, text }) {
    await init();
    return db.ref(`games/${gid}/chat`).push({ device: uid, pid, name, text: String(text).slice(0, 300), at: TS() }).catch(fail);
  }

  // cb is called once per message, oldest first, including ones already there.
  function watchChat(gid, cb) {
    const ref = db.ref(`games/${gid}/chat`).limitToLast(100);
    const h = (snap) => {
      const msg = L.cleanChat(snap.val());
      if (msg) cb({ id: snap.key, ...msg });
    };
    ref.on('child_added', h);
    return () => ref.off('child_added', h);
  }

  async function endGame(gid) {
    await init();
    return db.ref(`games/${gid}/meta/phase`).set('over').catch(() => {});
  }

  async function deleteGame(gid) {
    await init();
    return db.ref('games/' + gid).remove().catch(() => {});
  }

  const api = {
    configured,
    createGame,
    nameGame,
    admitSelf,
    addMyGame,
    removeMyGame,
    watchMyGames,
    setSeat,
    removeSeat,
    createInvite,
    revokeInvite,
    readInvite,
    watchInvite,
    claimInvite,
    answerInvite,
    removeInbox,
    watchInbox,
    watchSeats,
    readMeta,
    deleteInvite,
    watchMeta,
    startGame,
    publishState,
    readState,
    watchPresenceOf,
    watchState,
    sendChat,
    watchChat,
    endGame,
    deleteGame,
    init,
    deviceId,
    serverNow,
    onError: (h) => errorHandlers.push(h),
    publishPlayer,
    makeLinkCode,
    signInWithApple,
    useLinkCode,
    listMyPlayers,
    cleanCode,
    sessionId: () => SID,
    nameOwner,
    claimName,
    releaseName,
    addResult,
    readRankings,
    readRanking,
    readPlayer,
    removePlayer,
    setPresence,
    clearPresence,
    watchConnection,
    addFriend,
    watchFriends,
  };
  root.RK = Object.assign(root.RK || {}, { cloud: api });
})(typeof self !== 'undefined' ? self : this);
