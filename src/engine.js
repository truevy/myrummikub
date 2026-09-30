// Core Rummikub rules: tiles, set validation, scoring. No DOM, usable from node.
(function (root) {
  const COLOR_NAMES = ['black', 'red', 'blue', 'orange'];
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
    tiles.push({ id: id++, value: 0, color: -1, joker: true });
    tiles.push({ id: id++, value: 0, color: -1, joker: true });
    return tiles;
  }

  function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Tiles are read left to right. Runs must ascend; jokers stand in for the missing tile.
  function analyzeSet(tiles) {
    const n = tiles.length;
    if (n < 3) return { valid: false, type: null, points: 0 };
    const real = tiles.filter((t) => !t.joker);
    if (real.length === 0) return { valid: false, type: null, points: 0 };

    if (n <= 4 && real.every((t) => t.value === real[0].value)) {
      const colors = new Set(real.map((t) => t.color));
      if (colors.size === real.length) {
        return { valid: true, type: 'group', points: real[0].value * n };
      }
    }

    if (real.every((t) => t.color === real[0].color)) {
      const first = tiles.findIndex((t) => !t.joker);
      const start = tiles[first].value - first;
      if (
        start >= 1 &&
        start + n - 1 <= 13 &&
        tiles.every((t, i) => t.joker || t.value === start + i)
      ) {
        return { valid: true, type: 'run', points: n * start + (n * (n - 1)) / 2 };
      }
    }
    return { valid: false, type: null, points: 0 };
  }

  // A random identifier for games and player profiles.
  function newId() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function rackPenalty(tiles) {
    return tiles.reduce((sum, t) => sum + (t.joker ? JOKER_PENALTY : t.value), 0);
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
