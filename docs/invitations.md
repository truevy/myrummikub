# Inviting players over iMessage — design notes

Status: **implemented**, with a Firebase Realtime Database as the connection
between computers — see `docs/online.md` for how it is set up and used. This
file keeps the original reasoning about who counts as a known player. Where
the text below says "relay", read "the database".

## The goal

Someone starts a new game and invites people to it through iMessage. The people
they invite are *known*: Sara has a profile, she has won N times, her biggest
move was N tiles. There are no passwords yet.

## What "known" means

A person is known when they are in the roster on the inviter's computer: a
profile with a stable id, a name, a picture and an iMessage address (phone
number or email).

That gives one firm rule: **you invite a roster entry, never a typed-in
address.** To invite someone new you first register them (name and iMessage
address). Registering is the act of vouching for them, and it is the only place
an address enters the system, so it is validated once, there.

Today registration happens on one computer, in the setup screen. The roster
that feeds hot-seat games is the same roster invitations will pick from.

## Who is on the other end, without a password

Nothing the invited person types can prove who they are, so the proof has to
come from **where the invitation was delivered**.

An invitation is a link with a one-time secret in it, sent to Sara's own
iMessage address. Apple already makes sure that only Sara's devices receive
messages sent to that address. Whoever opens the link is therefore holding
Sara's Messages. This is the same assurance as a "reset your password" email,
and it needs no account, no password and no sign-up on Sara's side.

Rules that keep this honest:

- The secret is random, long, bound to one seat in one game, used once, and it
  expires.
- The host sees "Sara joined" and can remove the seat before the game starts.
- The app never sends the message on its own. It opens Messages with the text
  filled in and the host presses send, so the host always sees who it goes to.

What it does not protect against: Sara forwarding the link, or someone else
using her unlocked Mac or phone. For a family game that is acceptable. It is
the reason to keep anything valuable out of reach of an invitation alone.

## The path to something stronger

When passwords (or better, no passwords at all) are wanted, the upgrade is a
key per profile, created on the person's own device. The first invitation Sara
accepts pins her public key in the host's roster; later she must prove she
holds the same key. A forwarded link then stops working. Nothing stored today
has to change for this — it is one more field on the profile.

## The hard part: two copies of Sara

Today Sara's profile lives on the host's computer. Once she plays from her own
computer she will have a profile there too, with a different id. Several hosts
may each have registered her separately. So:

- A profile id is only meaningful on the computer that made it. It must never
  be treated as a global identity.
- The iMessage address is what ties the copies together. It should be unique
  within a roster (not yet enforced).
- After Sara first joins, the host's roster entry should remember her own id
  ("linked"), so later games recognise her without relying on the name.

### Statistics

"Sara has won N times" raises the question of whose count that is.

Statistics are **not** stored as counters. Every finished game is one entry in
a ledger, identified by its game id, listing each seat's place, biggest move
and tiles played. Statistics are worked out from the ledger. Recording the same
game twice does nothing, so two computers can each file the result of a shared
game, and ledgers can be merged later without double counting.

What the host's roster shows for Sara is then "the games this computer knows
about". If her totals should include games played elsewhere, her app can send
a summary when she joins; that is self-reported, which is fine for a friendly
game and should be labelled as such.

## What iMessage can and cannot do

An Electron app can open Messages with a prefilled message. It cannot receive
messages or run inside a conversation (that needs a Messages app extension,
which is a different kind of app). So iMessage carries the **invitation**, not
the game. The game itself needs a connection between the computers: a small
relay service, or a direct connection on the same network.

## Sketch of the flow

1. Host starts a new game and chooses "Invite…" for a seat, picking from the
   roster (only people with an iMessage address appear).
2. The app creates the game id and, per invited seat, a one-time secret with
   an expiry, and registers the game with the relay.
3. The app opens Messages addressed to that person with a link such as
   `rummi-tumi://join?game=…&seat=…&key=…`. The host presses send.
4. The invited person opens the link. Their app claims the seat with the
   secret; the relay marks it used.
5. After every turn the mover's app sends the turn; everyone else applies it.
6. At the end, every app files the result in its own ledger.

## What is already in place

- Profiles with a stable id, name, picture and optional, validated iMessage
  address (`src/profiles.js`). `invitable()` lists who could be invited.
- Statistics derived from a ledger keyed by game id; recording is idempotent.
- Every game has an id, and every human seat carries the profile id of the
  person sitting there. Both are kept in saved games.
- The whole game state can be written out and read back (`Game.toJSON`,
  `Game.fromJSON`), and every turn is recorded with the table before and
  after. Either can be sent over a connection as it stands.
- Computer and human seats are already distinct; a third kind, "remote", is
  the addition.

## Still to decide

- Should Sara's statistics follow her between computers, or is "games played
  with this host" enough? This decides whether a relay needs to store anything
  about people.
- Is a hosted relay acceptable, or should it work only on the same network?
- May a host register someone else (as now), or must each person register
  themselves on their own device before they can be invited?
