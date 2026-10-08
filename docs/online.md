# Online play — setting up the Firebase project

Online play (friends online, invitations, games across Macs) runs on a Firebase
Realtime Database. There is no server of ours: every copy of the app talks to
the database directly, and the database's own rules decide who may write what.
The free ("Spark") plan is more than enough for a family.

You only do this once, with your own Google account. It takes about ten minutes.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in.
2. **Create a project**. Name it anything (for example `rummi-tummi`; the one in use is called `lyndas-rummikub`, from the game's earlier name, and cannot be renamed).
   Google Analytics is not needed — turn it off when asked.

## 2. Turn on anonymous sign-in

Each Mac identifies itself with an anonymous account — nobody types a password.

1. In the left menu open **Build › Authentication** and press **Get started**.
2. Open the **Sign-in method** tab, choose **Anonymous**, switch it to
   **Enable**, and save.

## 3. Create the Realtime Database

1. Open **Build › Realtime Database** and press **Create database**.
2. Pick the location closest to you (for example `United States (us-central1)`).
3. Choose **Start in locked mode**. The rules from step 4 replace it.

## 4. Paste the rules

1. In the Realtime Database page open the **Rules** tab.
2. Replace everything there with the contents of `database.rules.json` from
   this project, and press **Publish**.

These rules are what keep players honest: a Mac may only write its own
players' records, only the person whose turn it is may publish the next turn,
and so on.

## 5. Copy the app's connection details into the game

1. Press the gear next to **Project Overview › Project settings**.
2. Under **Your apps** press the **`</>`** (Web) icon, give the app any
   nickname, leave Firebase Hosting unticked, and press **Register app**.
3. You will see a block like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "lyndas-rummikub.firebaseapp.com",
     databaseURL: "https://lyndas-rummikub-default-rtdb.firebaseio.com",
     projectId: "lyndas-rummikub",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "1:…:web:…"
   };
   ```

4. Open `src/config.js` in this project and paste those values into the
   `firebase` section. Only `apiKey`, `authDomain`, `databaseURL`, `projectId`
   and `appId` are used.

   If `databaseURL` is missing from the block, take it from the Realtime
   Database page — it is the address shown at the top of the **Data** tab.

These values are meant to be public: they say *which* database to talk to. The
rules from step 4 are what protect it.

## 6. Check it works

Start the app (`npm start`). Register a player and tick **Plays online from
this computer**. In the Firebase console, the **Data** tab of the Realtime
Database should now show `players` and `presence` entries for that person.

To try two players on one Mac during development, start a second copy with its
own data folder:

```bash
npx electron . --profile-dir=/tmp/rummikub-second
```

## Releases

Invitations sent by iMessage or email include a link where someone without the
app can download it: this project's GitHub Releases page (`releasesUrl` in
`src/config.js`). To publish a build there:

1. Merge the work into `main` and switch to it.
2. Raise `"version"` in `package.json` if that version was already released.
3. Run `npm run release`. It builds the universal app and attaches the disk
   image and the zip to a new release named after the version.

The app is not notarized by Apple, so the first launch on another Mac needs a
right-click and **Open**. The release notes say so.

## Playing online

- **Friends** are everyone you have sat at an online table with. The 🌐
  button shows how many are online and who is playing right now.
- **Inviting**: open 🌐 Online and press *Start an online game*. Friends who
  are online can be invited with one click; they get a popup with Accept,
  Decline and "ready in a few minutes". Anyone else can be invited by iMessage
  or email — the app fills in the message and the link, you press send.
- **Joining by link** works on any Mac with the app installed; a newcomer
  registers on the spot. Several people can join from the same Mac.
- **During the game** each computer sends the table after its player's turn;
  the others see the move animate in. Hints and move assist are off, and
  computer players cannot take part.
- **If someone drops offline** on their turn, everyone sees how long they have
  been away. After a minute the host (or, if the host is away, the next
  computer at the table) can skip them: a tile is drawn for them and play
  moves on. When they come back, their copy catches up by itself.
- **Points and rounds**: every game is scored the Rummikub way. When the
  first player goes out, everyone else loses what they still hold (a joker
  is 30) and the winner gains all of it; play then goes on for the places,
  unless **End the game when the first player has used all their tiles** was
  ticked when the game was set up (or, online, in the host's lobby).
  The host can deal the **next round** at the same table from the result
  screen. The others' computers join it by themselves while they are still
  on the result screen, or find it among their games, and the points add up
  across the rounds of the match.
- **After a restart** in the middle of an online game the app offers to
  rejoin it, picking up where the table is now.
- **Tidying up**: invitations are removed when the game starts, and a game is
  removed from the database by its host some minutes after it ends (or the
  next time the host's app starts).

## Trying it on one Mac

Each copy started with its own data folder behaves like a separate computer:

```bash
npx electron . --profile-dir=/tmp/rummikub-second
```

Invitation links are handled by the installed app, not by copies run from
source; use the "paste an invitation link" box on the new-game screen there.

## Chat

During an online game a chat panel sits on the right. Messages go to everyone
at the table and are removed with the game. On a shared computer a message is
sent in the name of whoever's rack is showing.

The chat needs the `chat` section of `database.rules.json`. If the rules in the
Firebase console were published before that section existed, paste the file
into the **Rules** tab again and press **Publish**.

## Rankings and unique names

- **Rankings**: when an online game ends, each computer adds the game to the
  record of its own players under `rankings/{player id}` (games and wins). The
  🌐 Online window shows the ten best, and where this computer's players stand.
  Games against the computer or on one device do not count.
- **Unique names**: a player who plays online registers their name under
  `names/{name in lower case}`. Saving a player whose name someone else holds
  is refused, so two online players are never called the same.

Both need the current `database.rules.json` in the Firebase console
(**Realtime Database › Rules**, paste the file, **Publish**). Until the rules
are published, the rankings say they could not be loaded and names are not
checked; everything else keeps working.

## Several games at once

Every online game a device has a seat in is kept in that account's list
(`devices/{account}/games`) and watched while the app is open. The list is on
the start screen, in the 🌐 Online window and behind 🎲 Games. A game can be
started two minutes after an invitation that has not been answered: the
absent player keeps a seat and can join later, and the game waits at their
turn. Such a game ends after two days if they never join. A finished game
stays in the database for a week, so that every player's device can record
the result, and is then removed by the host's app.

## The same players on several devices

A device signs in anonymously, so by itself it is its own account. To play
from a second device:

1. On the device that already plays: 🌐 Online › **Play on another device
   too**. It shows an eight-character code that is good for ten minutes.
2. On the other device: **Online** › **I already play on another device**,
   and enter the code.

Both devices are then the same account: the players, their games and their
rankings are on both, and a move can be made from either.

How it works: the first time a code is asked for, the anonymous account is
given a sign-in of its own (a made-up address ending in `.invalid` and a long
random key, stored under `accounts/{account}/key` where only that account can
read it). The code is a short-lived record under `links/{code}` that lets the
other device fetch that sign-in and use it.

**One-time console step:** in the Firebase console open **Authentication ›
Sign-in method**, choose **Email/Password**, switch on the first toggle
(**Email/Password**; leave "Email link" off) and **Save**. No real e-mail
address is ever used or asked for. Until this is done, asking for a code
explains that it is not switched on yet.

Sign in with Apple and Game Center are switched off in this version: online
play needs no login, as in 1.8. A device that was signed in with an Apple ID
keeps that account and its players. The hosted sign-in page
(`hosting/signin.html`) is no longer used by the app.
