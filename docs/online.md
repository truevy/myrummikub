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

## Logging in: Game Center or Sign in with Apple

🌐 Online opens a login window first; the online window with its games,
invitations and rankings comes after. The login is kept until the player
presses **Log out** (🌐 Online › **Account**), across restarts of the app.

- **Game Center** (iPhone and iPad only): iOS's own sign-in. The player's
  online wins also go to the Game Center leaderboard. Game Center is taken
  up again quietly at every start.
- **Sign in with Apple** (everywhere): ties the device's account to the
  Apple ID, see below.

Logging out of an account tied to an Apple ID leaves the account, with its
players, games and rankings, for the next sign-in; the device goes back to
being a fresh one of its own. Logging out of Game Center alone only ends
the login: the device's own anonymous account stays as it is.

## The same players on several devices: Sign in with Apple

A device signs in anonymously, so by itself it is its own account. Signing
in with an Apple ID ties the account to it: every device that signs in with
the same Apple ID afterwards plays as the same players, with their games,
rankings and statistics. A device that already had online players of its
own gives them up when it joins an account that has players (the screen
says so first).

- **iPhone and iPad**: Sign in with Apple uses Apple's own sheet in the app.
- **Mac and Windows**: the browser opens at
  <https://lyndas-rummikub.web.app/signin.html>, which does the sign-in and
  then opens the game again through its `rummi-tummi://auth…` link with the
  result. The page is `hosting/signin.html`, published with
  `firebase deploy --only hosting`.

### One-time console steps

1. **Apple on the phone**: Authentication › Sign-in method › add **Apple** ›
   enable › Save. Nothing else is needed for the native sheet.
2. **Apple in the browser (Mac and Windows)** also needs Apple's web set-up:
   - At <https://developer.apple.com/account/resources/identifiers/list/serviceId>
     create a **Services ID** (e.g. `com.lyndasrummitummi.signin`), enable
     **Sign In with Apple** on it, and under *Configure* set the primary App ID
     to `com.lyndasrummitummi.ios`, the domain to
     `lyndas-rummikub.firebaseapp.com` and the return URL to
     `https://lyndas-rummikub.firebaseapp.com/__/auth/handler`.
   - At <https://developer.apple.com/account/resources/authkeys/list> create a
     key with **Sign in with Apple** enabled (the push key cannot be reused),
     download the `.p8` and note its Key ID.
   - In the Firebase console's Apple provider, fill in the Services ID, the
     team ID `WFEP74PJYU`, the key ID and the key's contents, and Save.

Until step 2 is done, Sign in with Apple on a Mac ends in an error page;
the phone's Apple sheet and Game Center work independently of it.
