// Which push service a device token belongs to. An iPhone or iPad registers
// an Apple token (env "production" or "sandbox"); an Android phone or tablet
// registers a Firebase Cloud Messaging token (env "fcm"). Anything else in
// the database is ignored.
'use strict';

function serviceOf(info) {
  if (!info || typeof info !== 'object') return null;
  if (info.env === 'fcm') return 'fcm';
  if (info.env === 'sandbox') return 'apns-sandbox';
  if (info.env === 'production' || info.env === undefined) return 'apns';
  return null;
}

// The Firebase message for a notification: "gid" travels as data, so that a
// tap on the notification can open the game.
function fcmMessage(token, { title, body, gid }) {
  return {
    token,
    notification: { title, body },
    data: gid ? { gid: String(gid) } : {},
    android: { priority: 'high', notification: { channelId: 'turns', tag: gid ? String(gid) : undefined } },
  };
}

// Errors that mean the token is dead and should be forgotten.
const FCM_GONE = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
const fcmTokenGone = (err) => !!err && FCM_GONE.includes(err.code);

module.exports = { serviceOf, fcmMessage, fcmTokenGone };
