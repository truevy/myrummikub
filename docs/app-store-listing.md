# App Store listing — Lynda's Rummi Time

Copy and questionnaire answers for the App Store Connect submission.
Version 3.15.0. Screenshots are in `ios/screenshots/`, numbered in the order
they go up in App Store Connect: 2622×1206 (iPhone), 2752×2064 (iPad) and
2880×1800 (Mac). The first in every set, `*-1-splash.png`, is the game's own
splash screen (the logo and "Ad free forever"), captured from the app in the
iOS Simulator; the iPad and Mac ones put that capture on the splash's
background at their size. The others are rendered from the app's own
interface in Electron.

The first screenshot is the one shown in search results, so it goes first:
in App Store Connect, under the version's **Previews and Screenshots**, drag
`1-splash` to the front of each device's list (or delete the set and upload
the files in their numbered order).

## Names and URLs

| Field | Value |
| --- | --- |
| App name (30 max) | Lynda's Rummi Time: Tile Rummy |
| Subtitle (30 max) | Online with family and friends |
| Bundle ID | com.lyndasrummitummi.ios |
| Primary category | Games |
| Subcategories | Board, Family |
| Support URL | https://lyndas-rummi-time.web.app/support.html |
| Marketing URL | https://lyndas-rummi-time.web.app/support.html |
| Privacy policy URL | https://lyndas-rummi-time.web.app/privacy.html |
| Community rules | https://lyndas-rummi-time.web.app/terms.html |
| Copyright | 2026 Tom Rue |
| Price | USD 2.99 |

## Promotional text (170 max)

Play a round on your own against the computer, or take a turn a day in an
online game with friends and family. One game, every device.

## Description

Lynda's Rummi Time is a tile rummy game with a big, clear table and tiles you
drag with your finger.

PLAY HOW YOU LIKE
• Single player against computer opponents, from Beginner to Expert
• Same computer — pass the iPad around the table, two to four people
• Online with friends and family, up to four players

ONLINE, AT YOUR OWN PACE
Register a handle once and other players can find you. Start a private game
with people you invite by handle, or join the pool and be matched into a
random game. In a random game you have a whole day for each turn, so a game
can live quietly alongside the rest of the week. A notification tells you when
it is your turn, even when the game is closed.

MADE TO BE READABLE
Big tiles, strong colors and a table that uses the whole screen. A tile you
drag rides just above your finger so you can see where it is going. The move
log shows what everyone has played, and you can ask for a hint or for help
when you are stuck — or switch both off for a stricter game.

ON EVERY SCREEN
iPhone, iPad and computers play the same game together, and signing in with
Apple lets you play as the same person on more than one device.

No ads. No purchases. No sign-up needed to play on your own.

## Keywords (100 characters max, comma-separated)

board,classic,multiplayer,turn,based,puzzle,strategy,numbers,meld,joker,tabletop,offline,player

(95 characters.) The App Store searches only the name, the subtitle and
these keywords, and a word counts once wherever it is, so none of them repeats
a word of the name or subtitle ("rummy", "tile", "online", "family",
"friends" are covered there). Words combine across the fields: "turn" +
"based" matches "turn based", "board" + "game" from the category matches
"board game", "player" + "multiplayer" covers "2 player". Commas without
spaces; plurals are matched by themselves. "rummikub" is left out: it is
someone else's trademark, and Apple refuses a listing that uses it.

## What else moves the ranking

- **Ratings.** From 3.14 the game asks for one with Apple's own prompt, right
  after a win, once the player has finished three games (at most every four
  months; Apple shows it at most three times a year).
- **Downloads.** The paid price ($2.99) means far fewer downloads than a free
  app, and downloads are the biggest ranking signal. Free with an optional
  purchase would rank higher; that is a business choice.
- **App previews.** The videos in `ios/previews/` (iPhone, iPad, Mac) can be
  added next to the screenshots in App Store Connect. They do not change the
  search rank, but more people who see the listing download the game.
- **Name and subtitle** take effect with the next version sent for review.

## Review notes (App Review Information)

The game needs no account for Single player or Same computer. Multiplayer asks
you to register a handle; no email address or password is involved, and the
sign-in is anonymous. Sign in with Apple is offered only so one person can
play on two devices.

To see multiplayer without a second device, open Multiplayer, start a private
game and add a computer player with "Add a computer player".

Sign in with Apple: Online > Sign in with Apple, or Multiplayer > My handle and
picture. It asks Apple for the email only (no name), to show the player which
Apple ID they are signed in with. Signing in with the same Apple ID on a second device plays as the same
players there.

Account deletion: Multiplayer > My handle and picture > Delete my account, or
the menu on the start screen > Delete my account. An account tied to an Apple
ID asks for one last Sign in with Apple, and Apple's tokens are revoked.

Chat is switched off in this version, so players cannot send each other
messages.

Player content: names and handles are filtered when registering, and new players
accept the community rules (a tick box). Press the ⋯ next to a player in All
players to report or block them; Multiplayer > Blocked players undoes a block.
Reports are answered within 24 hours.

## Content rights

Suggested answer: no third-party content, if the game's art and text are the
developer's own. Player names and pictures are covered by the age rating's
user-generated content answer. The developer has to make this declaration.

## App Privacy answers

The developer has to make these declarations. Data collected and LINKED to the
user, not used for tracking:

| Category | What | Purpose |
| --- | --- | --- |
| Identifiers — User ID | anonymous Firebase account id, player id, handle | App Functionality |
| Identifiers — Device ID | notification token, if notifications are allowed | App Functionality |
| User Content — Photos or Videos | optional profile photo from the camera | App Functionality |
| User Content — Gameplay Content | games, results and rankings | App Functionality |
| Contact Info — Name | chosen table name / handle (not necessarily a real name) | App Functionality |
| Contact Info — Email Address | only with Sign in with Apple: the address Apple shares (possibly a private relay address), shown to the player on My handle and picture | App Functionality |
| Usage Data | none | — |
| Diagnostics | none | — |

- Used for tracking: NO
- Third-party advertising: NO
- Analytics: NO

Data stays on the device for Single player and Same computer.

## Age rating

The developer has to make these declarations.

- User-Generated Content: YES. The public player directory shows a handle, a
  chosen name and a picture, which can be a camera photo.
- Messaging and Chat: NO. Chat is switched off.
- Parental Controls, Age Assurance, Unrestricted Web Access, Social Media,
  Advertising: NO.
- Every mature-theme, medical, sexuality, violence and chance-based item: NONE.
  The game has no betting, prizes or loot boxes.

## Export compliance

Already answered in the app: `ITSAppUsesNonExemptEncryption` is false in
`ios/project.yml`, so no questions are asked at upload.

## After launch

Reports are promised an answer within 24 hours: see "Community rules, reports and
blocks" in `docs/multiplayer.md`.
