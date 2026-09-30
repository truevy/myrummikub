# Online play — setting up the Firebase project

Online play (friends online, invitations, games across Macs) runs on a Firebase
Realtime Database. There is no server of ours: every copy of the app talks to
the database directly, and the database's own rules decide who may write what.
The free ("Spark") plan is more than enough for a family.

You only do this once, with your own Google account. It takes about ten minutes.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in.
2. **Create a project**. Name it anything (for example `rummi-tumi`; the one in use is called `lyndas-rummikub`, from the game's earlier name, and cannot be renamed).
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
