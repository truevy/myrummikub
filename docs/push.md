# Push notifications

On every platform "Your turn" and invitations are announced:

| Where | How | While the game is closed |
| --- | --- | --- |
| iPhone, iPad | Apple's push service (below) | yes |
| Android | Firebase Cloud Messaging ([android.md](android.md)) | yes |
| Mac, Windows | the system's own notification, shown by the running game | only while it runs in the background (see below) |

"Your turn" and invitations reach a closed iPhone or iPad through Apple's
push service. The app stores its device token under
`v3/pushTokens/{account}/{token}` (3.0 keeps all of its data under `v3/`, see multiplayer.md); a small function at Firebase
(`functions/index.js`) watches the games and sends the notifications. While
the app is open, its own banner does the job and no system notification is
shown.

Only real game traffic turns into a notification: "your turn" goes only to
an account that lists the game among its own (it joined it), and an
invitation only when it comes from the host of the game it names. One
account can send at most 20 invitation notifications an hour, and one per
friend every five minutes; the count is kept under `v3/pushLog/`, which only
the function can read or write.

Setting this up once needs the three steps below. Until they are done the
app simply never receives a push; nothing else is affected.

## 1. Firebase: the Blaze plan

Cloud Functions need the pay-as-you-go plan. In the Firebase console, at the
bottom of the left sidebar, choose **Upgrade** and pick **Blaze**. A billing
account (card) is required; the monthly free allowance covers a game at
family scale, so the bill is $0–1 a month.

## 2. Apple: an APNs key

At <https://developer.apple.com/account/resources/authkeys/list> press **+**,
name the key (e.g. "Rummi Time push"), tick **Apple Push Notifications
service (APNs)**, and — important — press **Configure** and set the **Environment** to
**Sandbox & Production** (a key made for *Sandbox* only is refused by Apple for TestFlight and App Store
builds with `BadEnvironmentKeyInToken`; the key cannot be changed afterwards, make a new one). Continue and register. Download the `.p8` file (it can be
downloaded only once) and note the **Key ID** shown next to it.

The App ID `com.lyndasrummitummi.ios` also needs the **Push Notifications**
capability; Xcode's automatic signing adds it on the next TestFlight build.

## 3. Deploy the function

With the Firebase command-line tool (`npm install -g firebase-tools`, then
`firebase login`):

```bash
cd functions && npm install && cd ..
firebase use lyndas-rummikub
firebase functions:secrets:set APNS_KEY < ~/Downloads/AuthKey_XXXXXXXXXX.p8
firebase deploy --only functions
```

The first deploy asks for `APNS_KEY_ID` (the key id from step 2) and
`APNS_TEAM_ID` (`WFEP74PJYU`). It also publishes `database.rules.json`, which
adds `pushTokens`.

## Turning notifications on and off

The first time a registered player goes online, iOS asks for permission. After
that, **Settings › Notifications** in the app shows where things stand:

- **On**: nothing to do. Each time the app opens while online it refreshes the
  device's token with the account.
- **Not on yet**: a button asks iOS again.
- **Off**: iOS never asks twice, so the button opens the app's page in iOS
  Settings, where the person can switch notifications back on.

## Checking it works

Install a TestFlight build, open the app and go online once (iOS asks for
permission to show notifications). Then, from another device or account,
make a move in a shared game or send an invitation while the app is closed.
The function's log (`firebase functions:log`) shows each send and any
rejection by Apple.

TestFlight and App Store builds use Apple's production push service; a build
run from Xcode uses the sandbox. The app tells the function which one its
token is for.

## Mac and Windows

The desktop apps have no push service of their own: the game itself notices that
it is your turn (it watches your games while online) and shows the system's
notification, but only when its window is not the one in front. So that this
works with the window closed, **closing the window while you are online only
hides the game**: on a Mac it stays in the Dock (click it to bring the window
back), on Windows it stays in the tray, where a right click offers **Quit**.
Quit the game from the Dock menu or the tray to stop the notifications. Offline
players quit as usual when the window is closed. A tapped notification brings
the window back and opens the game.

## Android

See [android.md](android.md): a Firebase file for the app and the same function
deploy. The function picks the service from the token's `env` (`production` and
`sandbox` are Apple's, `fcm` is Android's).

## Checking every platform

1. iPhone or iPad: install a TestFlight build, go online, make a move from
   another account with the app closed.
2. Android: install the APK (with `google-services.json`), the same test.
3. Mac and Windows: go online, close the window, make a move from another
   account; the notification appears, and a click opens the game.
`firebase functions:log` shows each send and any rejection.

## Chat messages

(The chat is switched off for now, see multiplayer.md, so this does not happen at the moment; the function and the
notification stay in place for when it is switched on again.)

A chat message in a game notifies the other players' devices (the Cloud Function `chatMessage`):
title "<name> in “<game>”", the text as the body, a tap opens the game. Nobody is notified who has
that game open right now, nor at a table without chat, nor in a game that is over; at most six
notifications a minute go to one person for one game. The Mac and Windows apps, which have no push
service, show the system notification themselves when the window is not in front, for a chat message
and for your turn in the game that is open.

## When notifications do not arrive

**Settings › Notifications › Send me a test notification** (on an iPhone, iPad or Android device that is
online) asks the server to send this account's devices a test and says what happened:

- *No answer from the server*: the notification functions are not deployed
  (`firebase deploy --only functions`, which needs the Blaze plan), or `functions:log` shows why.
- *No phone or tablet is registered*: the app has not saved a device token. Open the game online with
  notifications allowed (iOS Settings › Rummi Time › Notifications must be on); a token then appears under
  `v3/pushTokens/<account>` in the Firebase console.
- *Not delivered: Apple (production): BadEnvironmentKeyInToken*: the APNs key was made for the sandbox only.
  Make a new key with Environment **Sandbox & Production**, then
  `firebase functions:secrets:set APNS_KEY < AuthKey_XXXX.p8`, put the new Key ID in
  `functions/.env` (`APNS_KEY_ID=…`, the file is in the repository) and
  `firebase deploy --only functions`; the Settings test explains this in the app.
- *Not delivered: Apple (production): BadDeviceToken*: the token is for the other Apple environment (a
  build run from Xcode uses the sandbox, TestFlight and the App Store the production one) or the APNs key
  or team id is wrong; the function removes dead tokens and the next launch registers a fresh one.
- *Sent to N devices* but nothing shows: check that Do Not Disturb or a Focus is off, and that the app's
  notifications are allowed.

`firebase functions:log` shows each send and every refusal.
