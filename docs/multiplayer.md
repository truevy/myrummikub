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

- typing their **exact handle**, with or without the @ (a line under the box says what happened: looking up, invited, or why it did not work) (private players can only be reached this way),
- tapping someone from **Recently played with** (the last 30 people you shared
  a game with, newest first), or
- the friends and message invitations that already existed in 2.x.

Turns in a private game are not limited in time. **The chat is switched off for now** (every game says
`chat: false`, the database rules refuse messages, and the chat panel and notifications are gone): there is
no moderation yet (reporting, blocking, filtering). To bring it back: `CHAT_ENABLED` in `src/lobby.js`, the
`games/{gid}/chat` rule in `database.rules.json`, and the existing `chatMessage` function.

A table has **up to four players**, the host included. The host can also seat **up to two
computer players** with **🤖 Add a computer player** in the lobby (and choose how well each plays,
Beginner to Expert), so a game can be you and a computer, or two friends and two computers.
A computer is not a registered player: it has no handle and no statistics, is not added to your
friends or recent players, and cannot be asked for help. The host's computer plays its moves and
sends them to the others, so **the host has to have the game open** when it is a computer's turn
(a notification says so, as for any turn); if the host is away, the others can skip the computer's
turn after a while, the way they can skip an absent player's. The seats and the host's moves are
checked by the database rules (`v3/games/{gid}/meta/players` accepts a computer only on the host's
computer and with a level from 1 to 5; `state` lets only the host's computer move for it).

## All players, and challenging them

Multiplayer › **All players** lists everyone who has registered as **public**, the
most recently around first, with their handle and when they were last active. A
search box narrows it by the start of a handle or by name; **Show more** loads
further. **⚔️ Challenge** opens a private game for the two of you: you choose hints
and "I need help", and the invitation goes out at once (the other player hears it
as a notification and finds it with their invitations). Private players are not
listed; they can only be invited by typing their exact handle in a private game.

The list is `v3/directory` in the database: a public player's handle, name, picture
glyph and last-active time, written by the player's own device each time it goes
online and removed when they go private or delete the player. Deploy the new rules
with `firebase deploy --only database`; until then the screen explains that the
server is not set up for it yet.

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
columns on a phone held sideways, up to 40 on a big window, about 28 on an iPad
held sideways (bigger tiles for fingers), never fewer than the old 22. On a phone the whole table fits without scrolling. Saved games and
2.x online games keep their 22 columns. A 2.x app cannot open a wider game.

## Ending a game, and quitting

When the first player has used all their tiles, a screen announces the winner and
**the winner chooses**: **End game** (the points stand as they were counted when they
went out) or **Keep playing** until everyone has played all their tiles. In a game against
the computer the person playing chooses (also when the computer went out first); in a game
on one computer the winner's seat chooses; in an online game the winner chooses on their
own device and the others follow. A game set up to end by itself at the first player out
(the checkbox in the new-game screen) does not ask.

In single player and on one computer, **☰ › Quit game** stops the game and goes back to the
start screen; nothing is recorded.

## Deleting your account

**Multiplayer › My handle and picture › Delete my account** (also **☰ › Delete my account…** on the start
screen) deletes the account for good after two confirmations: the handle and name are freed, the player
leaves the list of players, and the rankings, friends, recent players, invitations received, queue entry,
notification settings and list of games are removed; games being played are left (the player drops out), an
open lobby or finished game the account hosted is deleted, and the sign-in itself is removed
(`Cloud.deleteAccount`). The players on the device that play online are removed with their statistics, and the
app restarts with nobody signed in. Games and players that exist only on the device are not touched. Copies of
the name that other players hold (in their own friends and recent lists, or in a finished game's record) are
theirs to remove.

## Abandoning a multiplayer game

Once a multiplayer game is being played, any player can drop out of it: **☰ › Abandon game**
inside the game, **🏳️ Abandon** on the screen shown when you come back to a game, or the 🏳️ beside a
game in the games list and in **Your games**. After a confirmation the player's tiles go back into
the pool and the others play on; the last player left wins (in a game of two, the other player
wins). It counts as a loss in the player's rankings, the same as running out of time. The game
leaves the abandoning player's list.

How it works: on their own turn the player drops out right away from their device. Otherwise
the device writes a request under `v3/games/{gid}/leave/{seat}` (only the owner of that seat may)
and the Cloud Function `playerLeft` takes the seat out of the game, so deploy the functions and the
rules after updating (`firebase deploy --only database,functions`). The host can still **end the
game for everyone** with the ✕ in the list.

## The games going on, when the app opens

Opening the app shows **Your games** whenever a game is still being played: multiplayer games
at the top (the ones waiting for you first), then the single device game (people taking turns
on this computer), then the single player game, each with a **Play** button. A game on this
computer is saved after every turn, so it is there after the app was closed; one game on this
computer is kept at a time. ✕ abandons it. The list updates while it is open.

## Switching to Multiplayer from a game

The 🌐 **Multiplayer** button in a game opens the same Multiplayer screen as the start screen (Random
game, Private game, All players, your games, your handle). From a game against the computer, the game
on this computer is saved first and **← Back to your game** resumes it (it is also in the list of games);
from an online game the game stays open behind the screen and Back returns to it.

## Jokers

Following the Rummikub rules, a joker already on the table cannot be taken before
your first 30-point meld: until then the table is hands-off (a tile dropped on a
played set is refused, with the reason). After the first meld you may swap a
joker for the tile it stands for, from your rack or the table, and then have to
use the joker in a set in the same turn. A joker is freed only when the real tile takes its
place: playing a tile equal to a joker somewhere else on the table is an ordinary play and
leaves the joker where it is.

## The start screen

The start screen is the same on every device: the three kinds of game (Single player,
Same computer, Multiplayer) and a **☰** button at the top right. The menu holds **Your
games** (with how many are going on), Load a saved game, Players and statistics, Settings,
Watch the computer play, the version and the number of registered players. Nothing on it
scrolls, even on an iPhone held sideways. When a game ends, the result screen offers
**Next round** (where it applies), **🏠 Home** and **New game** (the set-up screen of the same kind of game,
or Multiplayer after an online game).

The set-up screen of a new game is just as plain: how many computer (and human) players,
who they are, and how well the computers play, with **Back** and **Start game**. Its **☰** holds
the options: sounds, volume, move assist, the big-move celebration, "end the game by itself when
the first player is out", the registered players and statistics, and the odds of a first meld.
Like the start screen, it fits an iPhone held sideways without scrolling.

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

The start screen and the Multiplayer screen show how many players have
registered a handle. A function (`userCountUp`, `userCountDown`, and the
10-minute sweep) keeps the number at `v3/stats/users`; it is shown only once
the functions are deployed.

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
