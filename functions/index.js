// Push notifications for Lynda's Rummi Time.
//
// Runs at Firebase (Cloud Functions, 2nd generation). Everything lives under v3/ in
// the database, apart from the data of earlier versions. Triggers:
//   - a game's state changes  → "Your turn in “<name>”" to whoever is up
//   - an invitation lands in a player's inbox → "<host> invites you to a game"
//   - a player asks for a random game → matchmaker pairs the people waiting
//   - every few minutes → turnWatchdog reminds, and drops, players in random
//     games whose turn has gone unplayed for a day
// Notifications go straight to Apple's push service with the team's APNs key,
// so the app needs no extra library; it only hands over its device token
// (stored under pushTokens/{account}/{token} by the app itself).
//
// Set-up is described in docs/push.md.
'use strict';

const { onValueWritten, onValueCreated, onValueDeleted } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { serviceOf, fcmMessage, fcmTokenGone } = require('./routing.js');
const { ApnsClient, Notification, Errors } = require('apns2');
// the game rules and the random-game logic are the app's own files, copied here by scripts/sync-functions.js
const { pickMatches } = require('./shared/matchmaking.js');
const A = require('./shared/arena.js');
const { newId } = require('./shared/engine.js');

initializeApp();

const APNS_KEY = defineSecret('APNS_KEY'); // the contents of the .p8 file
const APNS_KEY_ID = defineString('APNS_KEY_ID'); // the key's 10-character id
const APNS_TEAM_ID = defineString('APNS_TEAM_ID', { default: 'WFEP74PJYU' });
const BUNDLE_ID = 'com.lyndasrummitummi.ios';
const REGION = 'us-central1';
const INSTANCE = 'lyndas-rummikub-default-rtdb';

const clients = {};
function client(env) {
  if (!clients[env]) {
    clients[env] = new ApnsClient({
      team: APNS_TEAM_ID.value(),
      keyId: APNS_KEY_ID.value(),
      signingKey: APNS_KEY.value(),
      defaultTopic: BUNDLE_ID,
      host: env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com',
    });
  }
  return clients[env];
}

// Sends one notification to every device of an account: Apple's push service
// for an iPhone or iPad, Firebase Cloud Messaging for an Android device. Tokens
// the service no longer knows are removed.
async function notify(uid, { title, body, gid, badge }) {
  const db = getDatabase();
  const snap = await db.ref(`v3/pushTokens/${uid}`).get();
  const tokens = snap.val() || {};
  // what happened, for the "send me a test" in Settings: how many devices, how many got it, why not
  const outcome = { devices: 0, sent: 0, failed: [] };
  for (const [token, info] of Object.entries(tokens)) {
    const service = serviceOf(info);
    if (!service) continue;
    outcome.devices++;
    if (service === 'fcm') {
      try {
        await getMessaging().send(fcmMessage(token, { title, body, gid }));
        outcome.sent++;
      } catch (err) {
        outcome.failed.push(`Android: ${err.code || err.message}`);
        if (fcmTokenGone(err)) await db.ref(`v3/pushTokens/${uid}/${token}`).remove();
        else console.warn('fcm push to', uid.slice(0, 6), 'failed:', err.code || err.message);
      }
      continue;
    }
    const env = service === 'apns-sandbox' ? 'sandbox' : 'production';
    const note = new Notification(token, {
      alert: { title, body },
      sound: 'default',
      badge: badge === undefined ? 1 : badge,
      data: gid ? { gid } : {},
      pushType: 'alert',
    });
    try {
      await client(env).send(note);
      outcome.sent++;
    } catch (err) {
      const reason = err && err.reason;
      outcome.failed.push(`Apple (${env}): ${reason || err.message}`);
      if ([Errors.badDeviceToken, Errors.unregistered, Errors.deviceTokenNotForTopic].includes(reason)) {
        await db.ref(`v3/pushTokens/${uid}/${token}`).remove();
      } else {
        console.warn('push to', uid.slice(0, 6), 'failed:', reason || err.message);
      }
    }
  }
  return outcome;
}

// Names in a notification come from other players: keep them short and plain.
const short = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

// At most this many invitation notifications go out from one account per
// hour, and one per friend every few minutes, so nobody can be flooded.
const INVITES_PER_HOUR = 20;
const SAME_FRIEND_MS = 5 * 60 * 1000;
async function mayNotifyInvite(fromUid, pid) {
  const now = Date.now();
  const result = await getDatabase()
    .ref(`v3/pushLog/${fromUid}`)
    .transaction((cur) => {
      const log = cur && now - cur.since < 3600e3 ? cur : { since: now, count: 0, to: {} };
      const to = log.to || {};
      if (log.count >= INVITES_PER_HOUR || now - (to[pid] || 0) < SAME_FRIEND_MS) return; // refused: leave as is
      return { since: log.since, count: log.count + 1, to: { ...to, [pid]: now } };
    });
  return result.committed;
}

// How many of the account's games wait for it: the badge number.
async function gamesWaitingFor(uid) {
  const db = getDatabase();
  const list = (await db.ref(`v3/devices/${uid}/games`).get()).val() || {};
  let waiting = 0;
  for (const gid of Object.keys(list)) {
    const meta = (await db.ref(`v3/games/${gid}/meta`).get()).val();
    const state = (await db.ref(`v3/games/${gid}/state`).get()).val();
    if (!meta || meta.phase !== 'playing' || !state) continue;
    const current = Number(state.current) || 0;
    const players = Array.isArray(meta.players) ? meta.players : Object.values(meta.players || {});
    if (players[current] && players[current].device === uid) waiting++;
  }
  return waiting;
}

// The game moved on: tell the player who is up now, unless the move was
// made on one of their own devices and they are still looking at it.
exports.yourTurn = onValueWritten(
  { ref: '/v3/games/{gid}/state', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    const after = event.data.after.val();
    if (!after || typeof after.json !== 'string') return;
    const before = event.data.before.val();
    if (before && before.current === after.current && before.rev === after.rev) return;
    let game;
    try {
      game = JSON.parse(after.json);
    } catch (err) {
      return;
    }
    if (game.over) return;
    const meta = (await getDatabase().ref(`v3/games/${event.params.gid}/meta`).get()).val();
    if (!meta || meta.phase !== 'playing') return;
    const players = Array.isArray(meta.players) ? meta.players : Object.values(meta.players || {});
    const next = players[after.current];
    if (!next || !next.device || next.device === 'none') return;
    if (next.device === after.by) return; // the same account moved: its own device knows
    // only an account that took part in the game itself (it lists the game
    // among its own) hears about it; a game's host cannot make up players
    const joined = await getDatabase().ref(`v3/devices/${next.device}/games/${event.params.gid}`).get();
    if (!joined.exists()) return;
    const name = short(meta.name, 30) || `${short((players[0] || {}).name, 12) || 'A'}'s game`;
    await notify(next.device, { title: `Your turn in “${name}”`, body: `${short(next.name, 12) || 'You'}, the table is waiting for you.`, gid: event.params.gid, badge: await gamesWaitingFor(next.device) });
  }
);

// A chat message in a game: tell the other players' devices, unless they have that game open right now
// (the app shows the message itself) or the table has no chat.
const CHATS_PER_MINUTE = 6; // per game and recipient, so a flood of messages is not a flood of notifications
exports.chatMessage = onValueCreated(
  { ref: '/v3/games/{gid}/chat/{id}', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    const msg = event.data.val();
    const { gid } = event.params;
    if (!msg || typeof msg.text !== 'string' || typeof msg.device !== 'string') return;
    const db = getDatabase();
    const meta = (await db.ref(`v3/games/${gid}/meta`).get()).val();
    if (!meta || meta.phase !== 'playing' || (meta.options && meta.options.chat === false)) return;
    const players = Array.isArray(meta.players) ? meta.players : Object.values(meta.players || {});
    const devices = Object.keys(meta.devices || {}).filter((d) => d !== msg.device && d !== 'none');
    const gameName = short(meta.name, 30) || 'your game';
    for (const uid of devices) {
      // only an account that took part in the game itself (it lists the game among its own)
      if (!(await db.ref(`v3/devices/${uid}/games/${gid}`).get()).exists()) continue;
      // looking at this very game: the app shows the message itself
      let watching = false;
      for (const p of players.filter((q) => q && q.device === uid)) {
        const presence = (await db.ref(`v3/presence/${p.pid}`).get()).val();
        if (presence && presence.online === true && presence.game === gid) watching = true;
      }
      if (watching) continue;
      const now = Date.now();
      const log = await db.ref(`v3/pushLog/chat/${uid}/${gid}`).transaction((cur) => {
        const c = cur && now - cur.since < 60e3 ? cur : { since: now, count: 0 };
        if (c.count >= CHATS_PER_MINUTE) return; // refused: leave as is
        return { since: c.since, count: c.count + 1 };
      });
      if (!log.committed) continue;
      await notify(uid, { title: `${short(msg.name, 12) || 'Someone'} in “${gameName}”`, body: short(msg.text, 120), gid, badge: await gamesWaitingFor(uid) }).catch(() => {});
    }
  }
);

// "Send me a test notification" in Settings: the app writes pushTest/{uid}/request, this sends a
// notification to every device of the account and writes back what happened, so that a person can
// tell whether it works and, if not, why (no device registered, Apple's answer, ...).
exports.pushTest = onValueWritten(
  { ref: '/v3/pushTest/{uid}/request', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    if (!event.data.after.exists()) return;
    const { uid } = event.params;
    const db = getDatabase();
    const last = (await db.ref(`v3/pushTest/${uid}/result`).get()).val();
    if (last && Date.now() - last.at < 15000) {
      // one every few seconds is plenty
      await db.ref(`v3/pushTest/${uid}/result`).set({ at: Date.now(), devices: 0, sent: 0, failed: ['Please wait a few seconds between tests.'] });
      return;
    }
    let result;
    try {
      const out = await notify(uid, { title: 'Notifications work 🎉', body: "This is a test from Lynda's Rummi Time.", badge: 0 });
      result = { at: Date.now(), devices: out.devices, sent: out.sent, failed: out.failed.slice(0, 5) };
    } catch (err) {
      result = { at: Date.now(), devices: 0, sent: 0, failed: [String(err.message || err).slice(0, 200)] };
    }
    await db.ref(`v3/pushTest/${uid}/result`).set(result);
  }
);

// An invitation arrived for a registered player.
exports.invited = onValueCreated(
  { ref: '/v3/inbox/{pid}/{token}', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    const db = getDatabase();
    const player = (await db.ref(`v3/players/${event.params.pid}`).get()).val();
    if (!player || !player.device) return;
    // only a real invitation, from the host of a real game, to this player
    const invite = (await db.ref(`v3/invites/${event.params.token}`).get()).val();
    if (!invite || invite.revoked === true || invite.to !== event.params.pid || !invite.from || !invite.game) return;
    const meta = (await db.ref(`v3/games/${invite.game}/meta`).get()).val();
    if (!meta || meta.hostDevice !== invite.from.device) return;
    if (!(await mayNotifyInvite(invite.from.device, event.params.pid))) return;
    const from = short(invite.from.name, 12) || 'A friend';
    const name = meta.name ? ` “${short(meta.name, 30)}”` : '';
    await notify(player.device, { title: `${from} invites you to a game${name}`, body: 'Open Lynda\'s Rummi Time to accept.', gid: invite.game });
  }
);


// ---- random games -----------------------------------------------------------
//
// A player who asks for a random game writes queue/{uid}. The matchmaker pairs
// the people waiting (the most recently active first), builds the game, and
// puts it in each player's list. From then on every turn has a clock: a
// reminder after 20 hours, and after 24 the player drops out and the game
// goes on without them.

const db = () => getDatabase();
const LOCK_MS = 60 * 1000;

// One matchmaker at a time: a lock that goes stale on its own.
async function withLock(name, fn) {
  const now = Date.now();
  const lock = await db().ref(`v3/locks/${name}`).transaction((cur) => (cur && now - cur < LOCK_MS ? undefined : now));
  if (!lock.committed) return;
  try {
    await fn();
  } finally {
    await db().ref(`v3/locks/${name}`).remove();
  }
}

// What the matchmaker needs to know about each request: who they are, how
// recently they were around, and how many games they are already in.
async function readQueue(now) {
  const raw = (await db().ref('v3/queue').limitToFirst(200).get()).val() || {};
  const out = [];
  for (const [uid, q] of Object.entries(raw)) {
    if (!q || typeof q.pid !== 'string') continue;
    const player = (await db().ref(`v3/players/${q.pid}`).get()).val();
    // only the owner of a registered, public player can wait for a game
    if (!player || player.device !== uid || !player.handle || player.visibility === 'private') {
      await db().ref(`v3/queue/${uid}`).remove();
      continue;
    }
    const presence = (await db().ref(`v3/presence/${q.pid}`).get()).val() || {};
    const list = (await db().ref(`v3/devices/${uid}/games`).get()).val() || {};
    let active = 0;
    for (const gid of Object.keys(list)) {
      const meta = (await db().ref(`v3/games/${gid}/meta`).get()).val();
      if (meta && meta.phase === 'playing') active++;
    }
    out.push({
      uid,
      pid: q.pid,
      name: String(player.name || '?').slice(0, 12),
      face: String(player.face || '🙂').slice(0, 8),
      size: q.size,
      hints: q.hints === true,
      help: q.help === true,
      cols: q.cols,
      at: Number(q.at) || now,
      lastSeen: presence.online === true ? now : Number(presence.at) || Number(q.at) || 0,
      active,
      multi: player.multi === true,
    });
  }
  return out;
}

async function runMatchmaker() {
  await withLock('matchmaker', async () => {
    const now = Date.now();
    const { matches, expired } = pickMatches(await readQueue(now), now);
    for (const e of expired) await db().ref(`v3/queue/${e.uid}`).remove();
    for (const group of matches) {
      const built = A.buildRandomGame(group, { now, gid: newId() });
      const writes = {
        [`v3/games/${built.gid}/meta`]: { ...built.meta, createdAt: ServerValue.TIMESTAMP, startedAt: ServerValue.TIMESTAMP },
        [`v3/games/${built.gid}/seats`]: built.seats,
        [`v3/games/${built.gid}/state`]: { ...built.state, at: ServerValue.TIMESTAMP },
      };
      for (const p of built.persons) {
        writes[`v3/devices/${p.device}/games/${built.gid}`] = { name: built.meta.name, host: false, at: ServerValue.TIMESTAMP };
        writes[`v3/queue/${p.device}`] = null;
      }
      await db().ref().update(writes);
      for (const p of built.persons) {
        await notify(p.device, { title: 'Your random game is ready', body: `${built.persons.length} players are at the table. You have a day for each turn.`, gid: built.gid, badge: await gamesWaitingFor(p.device) }).catch(() => {});
      }
    }
  });
}

exports.matchmaker = onValueWritten({ ref: '/v3/queue/{uid}', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] }, async (event) => {
  if (!event.data.after.exists()) return;
  await runMatchmaker();
});

// requests that arrived while nobody else was waiting are tried again; the
// count of registered players is brought up to date at the same time
exports.matchmakerSweep = onSchedule({ schedule: 'every 10 minutes', region: REGION, secrets: [APNS_KEY] }, async () => {
  await refreshUserCount();
  await runMatchmaker();
});

// ---- the number of registered players -------------------------------------------
//
// Clients cannot count handles themselves (they may only look one up, so that
// private players cannot be listed), so the server keeps the number at
// v3/stats/users. It is recounted, not incremented, so it corrects itself.

async function refreshUserCount() {
  const handles = await db().ref('v3/handles').get();
  await db().ref('v3/stats/users').set(handles.numChildren());
}
exports.userCountUp = onValueCreated({ ref: '/v3/handles/{key}', region: REGION, instance: INSTANCE }, refreshUserCount);
exports.userCountDown = onValueDeleted({ ref: '/v3/handles/{key}', region: REGION, instance: INSTANCE }, refreshUserCount);

// Keeps the clock of a random game: set after every move, gone when it ends.
exports.trackDeadline = onValueWritten({ ref: '/v3/games/{gid}/state', region: REGION, instance: INSTANCE }, async (event) => {
  const gid = event.params.gid;
  const after = event.data.after.val();
  const meta = (await db().ref(`v3/games/${gid}/meta`).get()).val();
  let over = false;
  try {
    over = !!after && JSON.parse(after.json).over === true;
  } catch (err) {
    over = true;
  }
  const deadline = over ? null : A.deadlineFor(meta, after, Date.now());
  if (deadline) await db().ref(`v3/deadlines/${gid}`).set(deadline);
  else await db().ref(`v3/deadlines/${gid}`).remove();
});

// A player abandoned a game: the game goes on without them (their tiles back in the pool, the
// last player left wins). They write games/{gid}/leave/{seat}; only the owner of that seat may.
exports.playerLeft = onValueCreated(
  { ref: '/v3/games/{gid}/leave/{seat}', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    const { gid } = event.params;
    const seat = Number(event.params.seat);
    const ref = db().ref(`v3/games/${gid}`);
    try {
      const meta = (await ref.child('meta').get()).val();
      if (!meta || meta.phase !== 'playing' || !Number.isInteger(seat)) return;
      // a few tries: somebody may move at the same moment
      for (let attempt = 0; attempt < 4; attempt++) {
        const state = (await ref.child('state').get()).val();
        if (!state) return;
        const out = A.forfeitSeat(state, seat);
        if (!out) return; // already over, or they had already gone
        const result = await ref.child('state').transaction((cur) => (cur && cur.rev === state.rev ? { ...out.record, at: Date.now() } : undefined));
        if (!result.committed) continue;
        if (out.over) await ref.child('meta/phase').set('over');
        return;
      }
    } finally {
      await ref.child(`leave/${event.params.seat}`).remove().catch(() => {});
    }
  }
);

exports.turnWatchdog = onSchedule({ schedule: 'every 15 minutes', region: REGION, secrets: [APNS_KEY] }, async () => {
  const now = Date.now();
  const due = (await db().ref('v3/deadlines').orderByChild('next').endAt(now).limitToFirst(100).get()).val() || {};
  for (const [gid, d] of Object.entries(due)) {
    const meta = (await db().ref(`v3/games/${gid}/meta`).get()).val();
    const state = (await db().ref(`v3/games/${gid}/state`).get()).val();
    // the clock belongs to a move that has since been played, or the game is over
    if (!meta || meta.phase !== 'playing' || !state || state.rev !== d.rev) {
      await db().ref(`v3/deadlines/${gid}`).remove();
      continue;
    }
    const players = Array.isArray(meta.players) ? meta.players : Object.values(meta.players || {});
    const mover = players[state.current];
    if (now >= d.due) {
      const out = A.forfeitTurn(state);
      if (!out) {
        await db().ref(`v3/deadlines/${gid}`).remove();
        continue;
      }
      // only if nobody moved while we were working it out
      const result = await db().ref(`v3/games/${gid}/state`).transaction((cur) => (cur && cur.rev === d.rev ? { ...out.record, at: Date.now() } : undefined));
      if (!result.committed) continue;
      if (out.over) await db().ref(`v3/games/${gid}/meta/phase`).set('over');
      if (mover && mover.device && mover.device !== 'none') {
        await notify(mover.device, { title: 'You dropped out of a game', body: 'Your turn ran out of time, so the game went on without you.', gid, badge: await gamesWaitingFor(mover.device) }).catch(() => {});
      }
    } else if (!d.reminded) {
      await db().ref(`v3/deadlines/${gid}`).update({ reminded: true, next: d.due });
      if (mover && mover.device && mover.device !== 'none') {
        await notify(mover.device, { title: 'Your turn is running out of time', body: 'About 4 hours left to play your turn, or you will drop out of the game.', gid }).catch(() => {});
      }
    }
  }
});
