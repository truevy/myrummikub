# Push notifications

"Your turn" and invitations reach a closed iPhone or iPad through Apple's
push service. The app stores its device token under
`pushTokens/{account}/{token}`; a small function at Firebase
(`functions/index.js`) watches the games and sends the notifications. While
the app is open, its own banner does the job and no system notification is
shown.

Only real game traffic turns into a notification: "your turn" goes only to
an account that lists the game among its own (it joined it), and an
invitation only when it comes from the host of the game it names. One
account can send at most 20 invitation notifications an hour, and one per
friend every five minutes; the count is kept under `pushLog/`, which only
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
service (APNs)**, continue and register. Download the `.p8` file (it can be
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

## Checking it works

Install a TestFlight build, open the app and go online once (iOS asks for
permission to show notifications). Then, from another device or account,
make a move in a shared game or send an invitation while the app is closed.
The function's log (`firebase functions:log`) shows each send and any
rejection by Apple.

TestFlight and App Store builds use Apple's production push service; a build
run from Xcode uses the sandbox. The app tells the function which one its
token is for.
