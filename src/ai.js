// AI player. Finds the best legal rearrangement of table + rack with an exact
// dynamic program over tile values 1..13. The state is, per colour, the lengths
// (capped at 3) of the up-to-two runs that end at the previous value, plus the
// number of jokers consumed so far.
(function (root) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.RK;

  const UNSET = -2147483648;
  const NEG = -1000000;
  let memo = null;

  function emptyCounts() {
    return Array.from({ length: 14 }, () => [0, 0, 0, 0]);
  }

  // avail[v][k]: tiles that may be used, need[v][k]: tiles that must be used.
  // Returns { score, sets } where sets are lists of { v, k, joker } or null if infeasible.
  function solve({ avail, need, jokers, jokersNeed, tileWeight, jokerWeight }) {
    if (!memo) memo = new Int32Array(13 * 3 * 65536);
    memo.fill(UNSET);

    const ea = [0, 0, 0, 0]; // per colour: how run slot A is extended (0 no, 1 tile, 2 joker)
    const eb = [0, 0, 0, 0];
    const g = [0, 0, 0, 0]; // per colour: tiles put into groups at this value

    function expand(v, st, ju, cb) {
      const jl = jokers - ju;
      const tw = tileWeight(v);
      const jw = jokerWeight(v);
      let stop = false;

      const rec = (k, nst, jr, gain, sumG, doubles) => {
        if (stop) return;
        if (k === 4) {
          for (let jg = 0; jg <= jl - jr && !stop; jg++) {
            const total = sumG + jg;
            let ok;
            if (total === 0) ok = true;
            else if (total <= 4) ok = total >= 3 && doubles === 0;
            else ok = total >= 6 && total <= 8;
            if (ok && cb(gain + jg * jw, nst, ju + jr + jg, jg)) stop = true;
          }
          return;
        }
        const code = (st >> (4 * k)) & 15;
        const a = code >> 2;
        const b = code & 3;
        const n = avail[v][k];
        const m = need[v][k];
        for (let xa = 0; xa < 3; xa++) {
          if (xa === 0 && (a === 1 || a === 2)) continue; // unfinished run must continue
          for (let xb = 0; xb < 3; xb++) {
            if (xb === 0 && (b === 1 || b === 2)) continue;
            if (a === b && xa < xb) continue; // symmetric slots
            const x = (xa === 1) + (xb === 1);
            const jx = (xa === 2) + (xb === 2);
            if (x > n || jr + jx > jl) continue;
            let na = xa ? Math.min(a + 1, 3) : 0;
            let nb = xb ? Math.min(b + 1, 3) : 0;
            if (na < nb) [na, nb] = [nb, na];
            const ncode = ((na << 2) | nb) << (4 * k);
            for (let gk = Math.max(0, m - x); gk <= n - x; gk++) {
              ea[k] = xa;
              eb[k] = xb;
              g[k] = gk;
              rec(k + 1, nst | ncode, jr + jx, gain + (x + gk) * tw + jx * jw, sumG + gk, doubles + (gk === 2));
              if (stop) return;
            }
          }
        }
      };
      rec(0, 0, 0, 0, 0, 0);
    }

    function best(v, st, ju) {
      if (v === 14) {
        for (let k = 0; k < 4; k++) {
          const code = (st >> (4 * k)) & 15;
          if (code !== 0 && code !== 12 && code !== 15) return NEG;
        }
        return ju >= jokersNeed ? 0 : NEG;
      }
      const key = ((v - 1) * 3 + ju) * 65536 + st;
      if (memo[key] !== UNSET) return memo[key];
      let top = NEG;
      expand(v, st, ju, (gain, nst, nju) => {
        const r = best(v + 1, nst, nju);
        if (r > NEG / 2 && gain + r > top) top = gain + r;
        return false;
      });
      memo[key] = top;
      return top;
    }

    const total = best(1, 0, 0);
    if (total <= NEG / 2) return null;

    // Walk the optimal path again to rebuild the actual sets.
    const cap = (run) => Math.min(run.length, 3);
    const sets = [];
    const open = [0, 1, 2, 3].map(() => [[], []]);
    let st = 0;
    let ju = 0;
    for (let v = 1; v <= 13; v++) {
      const target = best(v, st, ju);
      let pick = null;
      expand(v, st, ju, (gain, nst, nju, jg) => {
        const r = best(v + 1, nst, nju);
        if (r > NEG / 2 && gain + r === target) {
          pick = { nst, nju, jg, ea: ea.slice(), eb: eb.slice(), g: g.slice() };
          return true;
        }
        return false;
      });
      for (let k = 0; k < 4; k++) {
        const step = (run, how) => {
          if (how === 0) {
            if (run.length) sets.push(run);
            return [];
          }
          run.push({ v, k, joker: how === 2 });
          return run;
        };
        let A = step(open[k][0], pick.ea[k]);
        let B = step(open[k][1], pick.eb[k]);
        if (cap(A) < cap(B)) [A, B] = [B, A];
        open[k] = [A, B];
      }
      const groupTotal = pick.g.reduce((s, x) => s + x, 0) + pick.jg;
      if (groupTotal > 0) {
        const groups = groupTotal <= 4 ? [[]] : [[], []];
        const loose = [];
        for (let k = 0; k < 4; k++) {
          if (pick.g[k] === 2) groups.forEach((grp) => grp.push({ v, k, joker: false }));
          else if (pick.g[k] === 1) loose.push({ v, k, joker: false });
        }
        for (let j = 0; j < pick.jg; j++) loose.push({ v, k: -1, joker: true });
        for (const item of loose) {
          const smallest = groups.reduce((s, grp) => (grp.length < s.length ? grp : s));
          smallest.push(item);
        }
        groups.forEach((grp) => {
          grp.isGroup = true;
          sets.push(grp);
        });
      }
      st = pick.nst;
      ju = pick.nju;
    }
    for (let k = 0; k < 4; k++) open[k].forEach((run) => run.length && sets.push(run));
    return { score: total, sets };
  }

  // keyOf: how a tile counts for the solver. A real tile is its number and
  // colour; a joker is 'J' while it is wild, or the tile it stands for.
  const realKey = (t) => (t.joker ? 'J' : t.value * 4 + t.color);

  function signature(items, keyOf) {
    return items
      .map((t) => {
        if (t.v !== undefined) return t.joker ? 99 : t.v * 4 + t.k; // a solver descriptor
        const k = keyOf(t);
        return k === 'J' ? 99 : k;
      })
      .sort((x, y) => x - y)
      .join(',');
  }

  // Turn abstract sets into real tiles. Sets that already exist on the table are
  // kept as they are so the table does not get reshuffled needlessly.
  function assign(descSets, tableSets, rack, keyOf = realKey) {
    const bySig = new Map();
    tableSets.forEach((s, i) => {
      const sig = signature(s.tiles, keyOf);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(i);
    });
    const out = [];
    const pending = [];
    const kept = new Set();
    for (const desc of descSets) {
      const match = bySig.get(signature(desc, keyOf));
      if (match && match.length) {
        const idx = match.shift();
        kept.add(idx);
        out.push({ tiles: tableSets[idx].tiles, keep: idx });
      } else pending.push(desc);
    }
    const pools = new Map();
    const push = (t) => {
      const key = keyOf(t);
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(t);
    };
    tableSets.forEach((s, i) => !kept.has(i) && s.tiles.forEach(push));
    rack.forEach(push);
    const rackIds = new Set(rack.map((t) => t.id));
    const played = [];
    for (const desc of pending) {
      const tiles = desc.map((d) => pools.get(d.joker ? 'J' : d.v * 4 + d.k).shift());
      if (desc.isGroup) {
        // groups: colours in order, jokers last
        tiles.sort((x, y) => (x.joker ? 9 : x.color) - (y.joker ? 9 : y.color));
      }
      tiles.forEach((t) => rackIds.has(t.id) && played.push(t));
      out.push({ tiles, keep: null });
    }
    return { sets: out, played };
  }

  // How much of the rack each level actually notices, and how often the two
  // lowest levels simply overlook a move they could have made.
  const LEVELS = {
    1: { name: 'Beginner', sees: 0.6, misses: 0.25 },
    2: { name: 'Easy', sees: 0.75, misses: 0.1 },
    3: { name: 'Intermediate', sees: 0.75, misses: 0 },
    4: { name: 'Advanced', sees: 0.9, misses: 0 },
    5: { name: 'Expert', sees: 1, misses: 0 },
  };

  // Adds rack tiles onto the ends of runs and into groups without ever
  // breaking a set apart. Used by the easy AI.
  function extendSets(tableSets, rack) {
    const sets = tableSets.map((s, i) => ({ tiles: s.tiles.slice(), keep: i }));
    const left = rack.slice();
    const played = [];
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of sets) {
        for (let i = 0; i < left.length; i++) {
          const t = left[i];
          const tries = [s.tiles.concat([t]), [t].concat(s.tiles)];
          const fit = tries.find((tiles) => E.analyzeSet(tiles).valid);
          if (!fit) continue;
          s.tiles = fit;
          s.keep = null;
          played.push(t);
          left.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    return { sets, left, played };
  }

  // Sets built from the rack alone, with the table untouched.
  function newSetsOnly(rack, jokers, minScore) {
    const avail = emptyCounts();
    rack.forEach((t) => !t.joker && avail[t.value][t.color]++);
    for (const J of jokers ? [0, jokers] : [0]) {
      const res = solve({
        avail,
        need: emptyCounts(),
        jokers: J,
        jokersNeed: 0,
        tileWeight: (v) => v,
        jokerWeight: (v) => v,
      });
      if (res && res.score >= minScore && res.sets.length) return assign(res.sets, [], rack);
    }
    return null;
  }

  // Weaker levels overlook some of their tiles, and sometimes a whole move.
  function computeMove({ tableSets, rack, melded, aggressive, level = 5, rng = Math.random }) {
    const lvl = LEVELS[level] || LEVELS[5];
    if (rng() < lvl.misses) return { type: 'draw' };
    const seen = lvl.sees < 1 ? rack.filter(() => rng() < lvl.sees) : rack;
    return plan({ tableSets, rack: seen, melded, aggressive, level: LEVELS[level] ? level : 5 });
  }

  function plan({ tableSets, rack, melded, aggressive, level }) {
    const rackJokers = rack.filter((t) => t.joker).length;

    if (level <= 2 && melded) {
      const keptSets = tableSets.map((s, i) => ({ tiles: s.tiles, keep: i }));
      const ext = level === 2 ? extendSets(tableSets, rack) : { sets: keptSets, left: rack, played: [] };
      const fresh = newSetsOnly(ext.left, ext.left.filter((t) => t.joker).length, 1);
      const sets = ext.sets.concat(fresh ? fresh.sets : []);
      const played = ext.played.concat(fresh ? fresh.played : []);
      if (!played.length) return { type: 'draw' };
      return { type: 'play', sets, played, firstMeld: false };
    }

    if (!melded) {
      const avail = emptyCounts();
      rack.forEach((t) => !t.joker && avail[t.value][t.color]++);
      const need = emptyCounts();
      for (const J of rackJokers ? [0, rackJokers] : [0]) {
        const res = solve({
          avail,
          need,
          jokers: J,
          jokersNeed: 0,
          tileWeight: (v) => v,
          jokerWeight: (v) => v,
        });
        if (res && res.score >= E.FIRST_MELD_POINTS) {
          const a = assign(res.sets, [], rack);
          const keptSets = tableSets.map((s, i) => ({ tiles: s.tiles, keep: i }));
          return { type: 'play', sets: keptSets.concat(a.sets), played: a.played, firstMeld: true };
        }
      }
      return { type: 'draw' };
    }

    // A joker already on the table stands for a particular tile and counts as
    // that tile. It turns back into a wild card only if the tile it stands for
    // is played from the rack, so each joker gives two ways to plan the turn.
    const bound = [];
    for (const s of tableSets) {
      const roles = E.analyzeSet(s.tiles).roles || [];
      const takenHere = new Set(s.tiles.filter((t) => !t.joker).map((t) => t.color));
      s.tiles.forEach((t, i) => {
        if (!t.joker || !t.rep) return;
        const options = (roles[i] ? roles[i].colors : t.rep.colors).filter((c) => t.rep.colors.includes(c));
        const color = options.find((c) => !takenHere.has(c));
        const k = color !== undefined ? color : t.rep.colors[0];
        takenHere.add(k);
        bound.push({ tile: t, v: t.rep.value, k });
      });
    }
    bound.sort((x, y) => x.tile.id - y.tile.id);

    const plans = [[]];
    for (const b of bound) plans.push(...plans.map((p) => p.concat(b)));

    const tryPlan = (freed, jw) => {
      const avail = emptyCounts();
      const need = emptyCounts();
      let tableJokers = 0;
      const pseudo = new Map(); // joker id → the tile it counts as
      for (const s of tableSets) {
        for (const t of s.tiles) {
          const b = bound.find((x) => x.tile === t);
          if (t.joker && (!b || freed.includes(b))) tableJokers++;
          else {
            const v = b ? b.v : t.value;
            const k = b ? b.k : t.color;
            if (b) pseudo.set(t.id, v * 4 + k);
            avail[v][k]++;
            need[v][k]++;
          }
        }
      }
      rack.forEach((t) => !t.joker && avail[t.value][t.color]++);
      // freeing a joker means playing the tile it stands for from the rack
      const spare = rack.filter((t) => !t.joker);
      for (const b of freed) {
        const at = spare.findIndex((t) => t.value === b.v && b.tile.rep.colors.includes(t.color));
        if (at < 0) return null;
        need[b.v][spare[at].color]++;
        spare.splice(at, 1);
      }
      const res = solve({
        avail,
        need,
        jokers: tableJokers + rackJokers,
        jokersNeed: tableJokers,
        tileWeight: (v) => 10 + v,
        jokerWeight: () => jw,
      });
      const keyOf = (t) => (t.joker ? (pseudo.has(t.id) ? pseudo.get(t.id) : 'J') : t.value * 4 + t.color);
      return res ? assign(res.sets, tableSets, rack, keyOf) : null;
    };

    const attempt = (jw) => {
      let top = null;
      for (const freed of level >= 3 ? plans : [[]]) {
        const r = tryPlan(freed, jw);
        if (r && (!top || r.played.length > top.played.length)) top = r;
      }
      return top;
    };

    // Normally hold on to jokers unless they unlock other tiles; spend them
    // freely when that wins the game or when the game is about to end.
    let choice = attempt(rackJokers ? -8 : 0);
    if (rackJokers && level >= 4) {
      const all = attempt(30);
      const better = all && all.played.length > (choice ? choice.played.length : 0);
      if (better && (all.played.length === rack.length || aggressive)) choice = all;
    }
    if (!choice || choice.played.length === 0) return { type: 'draw' };
    return { type: 'play', sets: choice.sets, played: choice.played, firstMeld: false };
  }

  const api = { solve, computeMove, LEVELS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, api);
})(typeof self !== 'undefined' ? self : this);
