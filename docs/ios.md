# The iPhone and iPad app

One app runs on both. It is a small native shell (`ios/`) around the same web
code the Mac and Windows apps use, so game rules, computer players, online
play, chat and settings are the same everywhere, and an iPhone can play a Mac
online.

## Trying it in the simulator

```bash
npm run build:ios -- run                  # iPhone
npm run build:ios -- run "iPad (A16)"     # iPad
```

## Running it on your own iPhone or iPad

1. Connect the device to this Mac with a cable (or have it on the same Wi-Fi
   with wireless debugging set up).
2. `npm run build:ios -- open` opens the project in Xcode.
3. At the top of the Xcode window choose your device, then press **Run** (▶).
4. The first time, the device asks you to trust the developer: **Settings ›
   General › VPN & Device Management ›** your Apple ID **› Trust**.

Signing is automatic with the team already set in the project. An app
installed this way keeps working for a year with the paid developer
membership, then needs installing again.

## Giving it to other people: TestFlight

Other people's iPhones and iPads can only get the app through Apple. TestFlight
is Apple's way of handing a build to chosen people before (or instead of) the
App Store.

### Once: create the app on App Store Connect

1. At <https://developer.apple.com/account/resources/identifiers/list> press
   **+**, choose **App IDs › App**, give it the description `Rummi Time` and the
   explicit bundle ID `com.lyndasrummitummi.ios`, and register it. No capabilities
   need ticking.
2. At <https://appstoreconnect.apple.com> open **Apps**, press **+ › New App**:
   platform **iOS**, a name (it must be unique across the App Store, so
   `Lynda's Rummi Time` rather than `Rummi Time`), primary language, the
   bundle ID from step 1, and any SKU (for example `rummitummi`).

### Each build

```bash
npm run testflight
```

It tests, archives with your signing, and uploads. Apple then processes the
build for 10–30 minutes.

### Letting people in

In App Store Connect, open the app and its **TestFlight** tab.

- **Internal testing** (up to 100 people who are users on your App Store
  Connect account): create a group, add yourself and them. They can install as
  soon as the build has finished processing.
- **External testing** (up to 10,000 people, by email or a public link): create
  a group, add the build, fill in what to test and a contact. The first build
  goes through a short Beta App Review, usually within a day.

Testers install the free **TestFlight** app from the App Store and open the
invitation. A TestFlight build works for 90 days; upload a new one before then.

The export-compliance question is already answered in the app (it uses only
standard encryption), so builds are not held up waiting for it.

## How it differs from the Mac app

- **iPhone**: landscape only. The layout is compact: tools sit behind the ☰
  button, and the move log and chat slide in over the table.
- **iPad**: any orientation. Sideways it looks like the Mac app; upright the
  rack sits on its own line with its buttons underneath.
- A dragged tile rides just above your finger so you can see where it lands.
- Players, statistics and settings are kept in the app's own storage on the
  device (not in files you can browse). They do not sync between devices.
- Saving and loading a game uses the Files app.
- Invitations open Messages or Mail, and `rummi-tummi://` links open the app.

## How it is put together

- `ios/project.yml` describes the Xcode project; `xcodegen` turns it into
  `ios/RummiTummi.xcodeproj` (the build script does this each time).
- `ios/RummiTummi/GameView.swift` hosts the page in a web view, serves the
  game's files from the app bundle under `app://rummikub/` (the same address as
  on the Mac, so the online sign-in persists), and provides the page with the
  same `rkCloud` and `rkFiles` objects the Mac app's preload script does.
- A build step copies `index.html`, `src/` and `vendor/` into the app, so there
  is one copy of the game's code.
- The layout modes live in `src/styles.css` (`body.compact`, `body.narrow`,
  `body.touch`) and are chosen in `src/ui.js` from the window size.

## Game Center (optional sign-in)

In the 🌐 Online window on iPhone and iPad there is a **Sign in to Game
Center** button. It is optional: nothing in the game depends on it. Signing
in shows the player's Game Center name there and offers it as the name when a
new player is registered.

The app carries the Game Center entitlement
(`ios/RummiTummi/RummiTummi.entitlements`); Xcode's automatic signing adds
the capability to the App ID by itself.

**One-time step in App Store Connect:** open the app, and on its version page
(under *App Store*, or *TestFlight › Test Information* for a beta) tick
**Game Center**. Until the app is known to Game Center there, the sign-in
answers that the application is not recognised.

### Leaderboard

After every online game the app reports the online wins of this device's
players (the most, when several play here) to the leaderboard with the ID
`online_wins`, and the Online window has a **Game Center rankings** button
that opens Game Center's own screen.

**One-time step in App Store Connect:** in the app's **Game Center** section
(under *Features*), add a classic leaderboard with the ID `online_wins`,
score format *Integer*, sorted *High to Low*, and add it to the current
version's Game Center configuration. Scores sent before the leaderboard
exists are dropped by Apple without an error.
