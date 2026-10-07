// Push notifications for Lynda's Rummi Time.
//
// Runs at Firebase (Cloud Functions, 2nd generation). Two triggers:
//   - a game's state changes  → "Your turn in “<name>”" to whoever is up
//   - an invitation lands in a player's inbox → "<host> invites you to a game"
// Notifications go straight to Apple's push service with the team's APNs key,
// so the app needs no extra library; it only hands over its device token
// (stored under pushTokens/{account}/{token} by the app itself).
//
// Set-up is described in docs/push.md.
'use strict';

const { onValueWritten, onValueCreated } = require('firebase-functions/v2/database');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { ApnsClient, Notification, Errors } = require('apns2');

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

// Sends one notification to every device of an account. Tokens Apple no
// longer knows are removed.
async function notify(uid, { title, body, gid, badge }) {
  const db = getDatabase();
  const snap = await db.ref(`pushTokens/${uid}`).get();
  const tokens = snap.val() || {};
  for (const [token, info] of Object.entries(tokens)) {
    const env = info && info.env === 'sandbox' ? 'sandbox' : 'production';
    const note = new Notification(token, {
      alert: { title, body },
      sound: 'default',
      badge: badge === undefined ? 1 : badge,
      data: gid ? { gid } : {},
      pushType: 'alert',
    });
    try {
      await client(env).send(note);
    } catch (err) {
      const reason = err && err.reason;
      if ([Errors.badDeviceToken, Errors.unregistered, Errors.deviceTokenNotForTopic].includes(reason)) {
        await db.ref(`pushTokens/${uid}/${token}`).remove();
      } else {
        console.warn('push to', uid.slice(0, 6), 'failed:', reason || err.message);
      }
    }
  }
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
    .ref(`pushLog/${fromUid}`)
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
  const list = (await db.ref(`devices/${uid}/games`).get()).val() || {};
  let waiting = 0;
  for (const gid of Object.keys(list)) {
    const meta = (await db.ref(`games/${gid}/meta`).get()).val();
    const state = (await db.ref(`games/${gid}/state`).get()).val();
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
  { ref: '/games/{gid}/state', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
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
    const meta = (await getDatabase().ref(`games/${event.params.gid}/meta`).get()).val();
    if (!meta || meta.phase !== 'playing') return;
    const players = Array.isArray(meta.players) ? meta.players : Object.values(meta.players || {});
    const next = players[after.current];
    if (!next || !next.device || next.device === 'none') return;
    if (next.device === after.by) return; // the same account moved: its own device knows
    // only an account that took part in the game itself (it lists the game
    // among its own) hears about it; a game's host cannot make up players
    const joined = await getDatabase().ref(`devices/${next.device}/games/${event.params.gid}`).get();
    if (!joined.exists()) return;
    const name = short(meta.name, 30) || `${short((players[0] || {}).name, 12) || 'A'}'s game`;
    await notify(next.device, { title: `Your turn in “${name}”`, body: `${short(next.name, 12) || 'You'}, the table is waiting for you.`, gid: event.params.gid, badge: await gamesWaitingFor(next.device) });
  }
);

// An invitation arrived for a registered player.
exports.invited = onValueCreated(
  { ref: '/inbox/{pid}/{token}', region: REGION, instance: INSTANCE, secrets: [APNS_KEY] },
  async (event) => {
    const db = getDatabase();
    const player = (await db.ref(`players/${event.params.pid}`).get()).val();
    if (!player || !player.device) return;
    // only a real invitation, from the host of a real game, to this player
    const invite = (await db.ref(`invites/${event.params.token}`).get()).val();
    if (!invite || invite.revoked === true || invite.to !== event.params.pid || !invite.from || !invite.game) return;
    const meta = (await db.ref(`games/${invite.game}/meta`).get()).val();
    if (!meta || meta.hostDevice !== invite.from.device) return;
    if (!(await mayNotifyInvite(invite.from.device, event.params.pid))) return;
    const from = short(invite.from.name, 12) || 'A friend';
    const name = meta.name ? ` “${short(meta.name, 30)}”` : '';
    await notify(player.device, { title: `${from} invites you to a game${name}`, body: 'Open Lynda\'s Rummi Time to accept.', gid: invite.game });
  }
);
