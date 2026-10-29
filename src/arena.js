// What the server does for random games: build a game from matched players,
// and drop a player whose turn ran out of time. Pure functions over the same
// records the app reads, so they can be tested here and run in the Cloud
// Functions unchanged. No Firebase and no DOM.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./game.js') : root.RK;
  const M = node ? require('./matchmaking.js') : root.RK.matchmaking;

  const HOUR = 3600 * 1000;
  const TURN_MS = 24 * HOUR; // how long a player has for their turn in a random game
  const REMIND_MS = 20 * HOUR; // when they are reminded that time is running out
  const HINTS = 3;

  // entries: the matched players, [{ uid, pid, name, face, cols, hints, help }].
  // Returns everything to write for the new game, or throws if it is not a table.
  function buildRandomGame(entries, { now, gid, rng = Math.random, name = 'Random game' }) {
    if (!Array.isArray(entries) || entries.length < 2 || entries.length > 4) throw new Error('a game needs 2 to 4 players');
    const g = new G.Game({ id: gid, players: entries.map((e) => ({ name: e.name, isAI: false, profileId: e.pid })), cols: M.colsFor(entries) }, rng);
    const draws = g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    const persons = entries.map((e) => ({ pid: e.pid, device: e.uid, name: String(e.name).slice(0, 12), face: String(e.face || '🙂').slice(0, 8) }));
    const devices = {};
    persons.forEach((p) => (devices[p.device] = true));
    const hints = entries.every((e) => e.hints) ? HINTS : 0;
    const help = entries.every((e) => e.help);
    return {
      gid,
      persons,
      meta: {
        host: persons[0].pid,
        hostDevice: persons[0].device,
        name,
        createdAt: now,
        startedAt: now,
        phase: 'playing',
        players: persons,
        devices,
        start: { draws: draws.map((t) => t.id), current: g.current },
        round: 1,
        options: { hints, help, chat: false, kind: 'random' },
      },
      seats: persons.map((p) => ({ ...p, token: null, status: 'ready', at: 0 })),
      state: { rev: 0, by: 'server', sid: 'server', current: g.current, skipped: false, at: now, json: JSON.stringify(g) },
    };
  }

  // When the player whose turn it is runs out of time. null when the game does
  // not have a clock: only random games do, and only while they are being played.
  function deadlineFor(meta, state, now) {
    if (!meta || meta.phase !== 'playing' || !meta.options || meta.options.kind !== 'random') return null;
    if (!state || typeof state.json !== 'string' || !Number.isInteger(state.rev)) return null;
    const at = Number.isFinite(state.at) ? state.at : now;
    return { rev: state.rev, current: state.current, remind: at + REMIND_MS, due: at + TURN_MS, next: at + REMIND_MS, reminded: false };
  }

  // The state record after a player dropped out (the one on the move when seat is not given),
  // with who it was and whether the game ended. null if the game is already over or
  // unreadable, or that player has already gone.
  function forfeitSeat(state, seat) {
    let g;
    try {
      g = G.Game.fromJSON(JSON.parse(state.json));
    } catch (err) {
      return null;
    }
    if (g.over) return null;
    if (seat === undefined || seat === null) seat = g.current;
    if (!g.forfeitPlayer(seat)) return null;
    return {
      seat,
      over: g.over,
      winner: g.over ? g.result.winner : null,
      record: { rev: state.rev + 1, by: 'server', sid: 'server', current: g.current, skipped: false, forfeit: true, json: JSON.stringify(g) },
    };
  }

  // When the player whose turn it is runs out of time.
  const forfeitTurn = (state) => forfeitSeat(state);

  const api = { buildRandomGame, deadlineFor, forfeitTurn, forfeitSeat, TURN_MS, REMIND_MS, HINTS };
  if (node) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { arena: api });
})(typeof self !== 'undefined' ? self : this);
