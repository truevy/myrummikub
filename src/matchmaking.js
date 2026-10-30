// Pairing waiting players into random games. No Firebase and no DOM, usable
// from node and from the Cloud Function that does the pairing.
(function (root) {
  const WAIT_LIMIT_MS = 3 * 24 * 3600 * 1000; // a request nobody answered in this long is dropped
  const SIZES = [2, 3, 4];

  // queue: [{ uid, pid, size: 2|3|4, hints, help, lastSeen, at, active, multi, cols }]
  //   lastSeen: when the player was last in the app; at: when they asked
  //   active: how many games they are in now; multi: whether they accept more than one
  // Returns { matches: [[entry, ...], ...], expired: [entry, ...] }.
  //
  // The most recently active players are matched first, so that a game starts
  // with people who are really there. Each match has `size` different people.
  const blockedPair = (a, b) => (a.blocks || []).includes(b.pid) || (b.blocks || []).includes(a.pid);

  function pickMatches(queue, now) {
    const expired = [];
    const waiting = [];
    for (const e of queue) {
      if (!e || !SIZES.includes(e.size)) continue;
      if (now - e.at > WAIT_LIMIT_MS) expired.push(e);
      else if (e.active > 0 && !e.multi) continue; // already in a game and happy with just that one
      else waiting.push(e);
    }
    // players meet others who want the same size of game and the same options
    const keyOf = (e) => [e.size, e.hints ? 1 : 0, e.help ? 1 : 0].join('|');
    const groups = new Map();
    for (const e of waiting) groups.set(keyOf(e), (groups.get(keyOf(e)) || []).concat(e));
    const matches = [];
    for (const [key, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) { // smaller tables first, so the order is stable
      const size = +key.split('|')[0];
      group.sort((a, b) => b.lastSeen - a.lastSeen || a.at - b.at);
      const seen = new Set();
      const unique = group.filter((e) => !seen.has(e.uid) && seen.add(e.uid)); // one request per person
      // tables fill in that order, but never seat two people when one has blocked the other
      const left = unique.slice();
      while (left.length >= size) {
        const table = [left.shift()];
        for (let i = 0; i < left.length && table.length < size; ) {
          if (table.some((t) => blockedPair(t, left[i]))) i++;
          else table.push(left.splice(i, 1)[0]);
        }
        if (table.length === size) matches.push(table);
      }
    }
    return { matches, expired };
  }

  // A table width every player can use: the narrowest one asked for.
  const colsFor = (entries) => Math.min(...entries.map((e) => (Number.isInteger(e.cols) ? e.cols : 30)));

  const api = { pickMatches, colsFor, WAIT_LIMIT_MS, SIZES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { matchmaking: api });
})(typeof self !== 'undefined' ? self : this);
