// Turning a game into a record the database can carry, and back. No Firebase
// and no DOM, usable from node.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./game.js') : root.RK;

  // The record published after a finished turn. The whole game travels as one
  // JSON string: the database would otherwise drop the empty cells of the grids.
  function packState(game, rev, extra = {}) {
    return { rev, current: game.current, skipped: extra.skipped === true, json: JSON.stringify(game) };
  }

  // Rebuilds the game from a published record. Throws on a damaged record.
  function unpackState(record) {
    return G.Game.fromJSON(JSON.parse(record.json));
  }

  // Only a newer record than the one already applied counts.
  const acceptRev = (applied, incoming) => Number.isInteger(incoming) && incoming > applied;

  // People arrange their own rack while others play. When a remote state
  // arrives, this keeps the local layout and only adds or removes tiles so
  // that the set of tiles matches what the rest of the table knows.
  function mergeRack(localRack, remoteRack) {
    const remoteIds = new Set(remoteRack.filter(Boolean).map((t) => t.id));
    const localIds = new Set(localRack.filter(Boolean).map((t) => t.id));
    const rack = localRack.map((t) => (t && remoteIds.has(t.id) ? t : null));
    for (const t of remoteRack) {
      if (!t || localIds.has(t.id)) continue;
      let i = rack.indexOf(null);
      if (i < 0) {
        i = rack.length;
        rack.length += G.RACK_COLS;
        rack.fill(null, i);
      }
      rack[i] = t;
    }
    // keep the same number of rows the remote rack has, at least
    while (rack.length < remoteRack.length) rack.push(null);
    return rack;
  }

  // The last thing that happened, as the turn loop describes it.
  function lastActionOf(game) {
    const h = game.history[game.history.length - 1];
    if (!h) return null;
    return { player: h.player, type: h.type, count: h.count, place: h.place };
  }

  const api = { packState, unpackState, acceptRev, mergeRack, lastActionOf };
  if (node) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { sync: api });
})(typeof self !== 'undefined' ? self : this);
