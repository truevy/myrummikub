// Core Rummikub rules: tiles, set validation, scoring. No DOM, usable from node.
(function (root) {
  const COLOR_NAMES = ['blue', 'pink', 'purple', 'gold'];
  const JOKER_PENALTY = 30;
  const FIRST_MELD_POINTS = 30;

  function createTiles() {
    const tiles = [];
    let id = 0;
    for (let copy = 0; copy < 2; copy++) {
      for (let color = 0; color < 4; color++) {
        for (let value = 1; value <= 13; value++) {
          tiles.push({ id: id++, value, color, joker: false });
        }
      }
    }
    tiles.push({ id: id++, value: 0, color: -1, joker: true, rep: null });
    tiles.push({ id: id++, value: 0, color: -1, joker: true, rep: null });
    return tiles;
  }

  function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // One colour each for a list of allowed-colour lists, all different, or null.
  function distinctColors(lists, used = []) {
    if (!lists.length) return [];
    for (const c of lists[0]) {
      if (used.includes(c)) continue;
      const rest = distinctColors(lists.slice(1), used.concat(c));
      if (rest) return [c].concat(rest);
    }
    return null;
  }

  // Tiles are read left to right. Runs must ascend.
  //
  // A joker that has been played stands for one particular tile from then on
  // (tile.rep = { value, colors }) and behaves exactly like that tile wherever
  // it is moved. It is a free wild card only while it has no such identity, or
  // while its id is in `released` (the real tile it stood for was played this
  // turn). For a valid set, `roles` says what each joker stands for there.
  function analyzeSet(tiles, released) {
    const n = tiles.length;
    const fail = { valid: false, type: null, points: 0, roles: null };
    if (n < 3) return fail;
    const items = tiles.map((t) => {
      if (!t.joker) return { wild: false, v: t.value, colors: [t.color] };
      if (t.rep && !(released && released.has(t.id))) return { wild: false, v: t.rep.value, colors: t.rep.colors };
      return { wild: true };
    });
    const fixed = items.filter((it) => !it.wild);
    if (fixed.length === 0) return fail;

    if (n <= 4 && fixed.every((it) => it.v === fixed[0].v) && distinctColors(fixed.map((it) => it.colors))) {
      const taken = new Set(tiles.filter((t) => !t.joker).map((t) => t.color));
      const open = [0, 1, 2, 3].filter((c) => !taken.has(c));
      return {
        valid: true,
        type: 'group',
        points: fixed[0].v * n,
        roles: tiles.map((t, i) => (t.joker ? { value: fixed[0].v, colors: items[i].wild ? open : items[i].colors.filter((c) => !taken.has(c)) } : null)),
      };
    }

    const shared = [0, 1, 2, 3].filter((c) => fixed.every((it) => it.colors.includes(c)));
    if (shared.length) {
      const first = items.findIndex((it) => !it.wild);
      const start = items[first].v - first;
      if (start >= 1 && start + n - 1 <= 13 && items.every((it, i) => it.wild || it.v === start + i)) {
        return {
          valid: true,
          type: 'run',
          points: n * start + (n * (n - 1)) / 2,
          roles: tiles.map((t, i) => (t.joker ? { value: start + i, colors: shared } : null)),
        };
      }
    }
    return fail;
  }

  function rackPenalty(tiles) {
    return tiles.reduce((sum, t) => sum + (t.joker ? JOKER_PENALTY : t.value), 0);
  }

  // A random identifier for games and player profiles.
  function newId() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const api = {
    COLOR_NAMES,
    JOKER_PENALTY,
    FIRST_MELD_POINTS,
    createTiles,
    shuffle,
    analyzeSet,
    rackPenalty,
    newId,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, api);
})(typeof self !== 'undefined' ? self : this);
