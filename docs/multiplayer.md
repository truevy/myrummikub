# Multiplayer in version 3.0

Version 3.0 changes how people find each other. Instead of sending invitation
links, everyone registers once with a **handle**, and games are made either
from a **pool of available players** (random games) or by naming people by
their handle (private games). Single player and Same computer are unchanged,
except that their statistics are now kept apart from multiplayer's.

## Registering

The first time the app opens, a registration screen asks for:

- **A handle**: 3 to 16 letters, digits or underscores, not case sensitive and
  unique across everyone. It is how other people find you. It can be changed
  once every 30 days; the old one is released.
- **A picture**: a glyph (emoji) or a photo from the camera.
- **A name at the table** (optional): shown on your panel. Your handle is used
  if you leave it empty.
- **Public or private**. Public players join the pool of available players and
  can be matched to random games. A private player is only reachable by
  someone who types their exact handle.
- **More than one game at a time**: if this is off, a new game cannot be
  started or joined while another is still being played.
- **Game Center** (iPhone and iPad, optional): links your Game Center name to
  the player. It is not a sign-in.

"Skip for now" leaves single player and Same computer fully usable; registering
is asked for again when you open Multiplayer. You can edit all of this later
under Multiplayer › My handle and picture.

## Random games

Multiplayer › Random game. You choose 2, 3 or 4 players, and whether hints and
"I need help" are allowed. Players are matched with others who asked for the
same size and the same options, the most recently active first. The screen says
that this can take a long time.

- Each player has **24 hours for every turn**. After 20 hours they get a
  reminder notification. After 24 hours they **drop out**: their tiles go back
  into the pool and the others play on. The last player left wins. A player who
  drops out is ranked last, and it counts as a loss in their statistics.
- **There is no chat.**
- The table is as wide as the narrowest device among the players asked for.
- People you met in a random game go into your recently-played list, so you can
  invite them to a private game by their handle. They do not become friends.

## Private games

Multiplayer › Private game. You choose whether hints and "I need help" are
allowed, then invite people by:

- typing their **exact handle** (private players can only be reached this way),
- tapping someone from **Recently played with** (the last 30 people you shared
  a game with, newest first), or
- the friends and message invitations that already existed in 2.x.

Private games have a chat, and turns are not limited in time.

## Hints and "I need help"

Chosen when a multiplayer game is set up:

- **Hints**: each player may use up to **3** hints in the game. The Hint button
  shows how many are left. A hint costs one use for the whole turn however
  often it is opened. The count travels with the game and is remembered on the
  device, so reloading does not give hints back.
- **I need help**: a player can ask another player at the table to look at
  their tiles. The helper gets a banner and sees the tiles the asker held at
  the start of their turn. The asker can stop at any time.
  This is a friendly feature, not a secret-keeping one: every player's tiles
  are part of the game record the database holds, so a determined player can
  read them whether or not help is on.

## Statistics

Players and statistics keeps three separate sets: **Single player**,
**Same computer** and **Multiplayer**. Older games are sorted into them by how
they were played.

## The wider table

A game remembers its own width. New games choose it from the screen: about 36
columns on a phone held sideways, up to 40 on a big window, never fewer than
the old 22. On a phone the whole table fits without scrolling. Saved games and
2.x online games keep their 22 columns. A 2.x app cannot open a wider game.

## The menu

The tools (pause, speed, sound, settings, online, save, load, new game) live in
the ☰ menu from the very first moment of a game, so the top bar does not change
after the first turn.

## Separate from earlier versions

3.0 users are new users. Nothing from 2.x carries over:

- **On the device**: 3.0 keeps its players and statistics in its own store
  (`profiles3`). Players registered in 2.x are not listed and their statistics
  are not counted. The old files stay on the device, untouched, for a 2.x app.
- **On the server**: everything 3.0 stores online (players, handles, games, the
  random-game queue, rankings, invitations) lives under `v3/` in the database.
  The data of earlier versions, and the rules that protect it, are left exactly
  as they were, so 2.x apps keep working among themselves. 3.0 never reads or
  changes it. The notification functions serve 3.0 only.

To wipe the 3.0 data while testing, delete the `v3` node in the Firebase console.

## Setting up the server side

Version 3.0 adds database rules and Cloud Functions. After updating, deploy
both:

```bash
firebase deploy --only database,functions
```

- The rules gain `handles`, `queue`, `recent`, `deadlines` and a per-game
  `help` node, and the chat rule respects `meta/options/chat`.
- The functions `matchmaker`, `matchmakerSweep`, `trackDeadline` and
  `turnWatchdog` pair the pool and keep the 24-hour clocks. The scheduled ones
  use Cloud Scheduler, which needs the project to be on the **Blaze** plan.
- The functions run the app's own rule files. `firebase deploy` copies them into
  `functions/shared` first (see `scripts/sync-functions.js`), so deploy from a
  checkout of the same version as the app.
- The push key and team id are the same as in [push.md](push.md).

Without the functions, private games and everything else still work; random
games just stay in the queue.
