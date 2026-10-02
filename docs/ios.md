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

## Giving it to other people

Other people's iPhones and iPads can only get the app through Apple:

- **TestFlight** (up to 10,000 testers by invitation or link). In
  <https://appstoreconnect.apple.com> create an app record with the bundle id
  `com.myrummikub.ios`. In Xcode choose **Any iOS Device**, then **Product ›
  Archive**, then **Distribute App › TestFlight**. Testers install the
  TestFlight app and open your invitation.
- **App Store**, from the same archive, after Apple's review.

Neither has been set up yet.

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
