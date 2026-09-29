// Game state and turn flow. The table and the racks are grids of cells; a set on
// the table is any horizontal stretch of touching tiles.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const E = node ? require('./engine.js') : root.RK;
  const AI = node ? require('./ai.js') : root.RK;

  const COLS = 22;
  const MIN_ROWS = 7;
  const RACK_COLS = 18;
  const RACK_MIN_ROWS = 2;
  const HAND_SIZE = 14;

  // Put a tile into a grid cell, nudging neighbours sideways if the cell is taken.
  function gridInsert(cells, cols, idx, tile) {
    if (!cells[idx]) {
      cells[idx] = tile;
      return true;
    }
    const rowStart = idx - (idx % cols);
    const rowEnd = rowStart + cols - 1;
    let e = idx;
    while (e <= rowEnd && cells[e]) e++;
    if (e <= rowEnd) {
      for (let i = e; i > idx; i--) cells[i] = cells[i - 1];
      cells[idx] = tile;
      return true;
    }
    let s = idx;
    while (s >= rowStart && cells[s]) s--;
    if (s >= rowStart) {
      for (let i = s; i < idx; i++) cells[i] = cells[i + 1];
      cells[idx] = tile;
      return true;
    }
    return false;
  }

  class Game {
    constructor({ players }, rng = Math.random) {
      this.rng = rng;
      this.cols = COLS;
      this.rows = MIN_ROWS;
      this.board = new Array(COLS * MIN_ROWS).fill(null);
      this.players = players.map((p, i) => ({
        id: i,
        name: p.name,
        isAI: !!p.isAI,
        rack: new Array(RACK_COLS * RACK_MIN_ROWS).fill(null),
        melded: false,
      }));
      this.pool = E.shuffle(E.createTiles(), rng);
      this.current = 0;
      this.passes = 0;
      this.over = false;
      this.result = null;
      this.turn = null;
      this.lastPlayed = new Set();
      this.lastAction = null;
    }

    // ---- setup -------------------------------------------------------------

    // Every player reveals one tile, the highest number starts.
    pickFirstPlayer() {
      const candidates = this.pool.filter((t) => !t.joker);
      let draws;
      let top;
      do {
        const s = E.shuffle(candidates.slice(), this.rng);
        draws = this.players.map((_, i) => s[i]);
        top = Math.max(...draws.map((t) => t.value));
      } while (draws.filter((t) => t.value === top).length !== 1);
      this.current = draws.findIndex((t) => t.value === top);
      return draws;
    }

    deal() {
      for (const p of this.players) {
        for (let i = 0; i < HAND_SIZE; i++) this.addToRack(p, this.pool.pop());
        this.sortRack(p, 'runs');
      }
    }

    beginTurn() {
      const p = this.players[this.current];
      this.trimRack(p);
      this.turn = {
        startBoard: this.board.slice(),
        startRows: this.rows,
        startIds: new Set(this.board.filter(Boolean).map((t) => t.id)),
        startRack: p.rack.slice(),
        startMelded: p.melded,
      };
    }

    // ---- racks -------------------------------------------------------------

    rackTiles(p) {
      return p.rack.filter(Boolean);
    }

    addToRack(p, tile) {
      let i = p.rack.indexOf(null);
      if (i < 0) {
        i = p.rack.length;
        for (let k = 0; k < RACK_COLS; k++) p.rack.push(null);
      }
      p.rack[i] = tile;
    }

    trimRack(p) {
      while (p.rack.length > RACK_COLS * RACK_MIN_ROWS) {
        const lastRow = p.rack.slice(p.rack.length - RACK_COLS);
        if (lastRow.some(Boolean)) break;
        p.rack.length -= RACK_COLS;
      }
    }

    sortRack(p, mode) {
      const tiles = this.rackTiles(p);
      const key =
        mode === 'groups'
          ? (t) => (t.joker ? 9999 : t.value * 10 + t.color)
          : (t) => (t.joker ? 9999 : t.color * 100 + t.value);
      tiles.sort((a, b) => key(a) - key(b));
      const breakKey = (t) => (t.joker ? -1 : mode === 'groups' ? t.value : t.color);
      // leave a gap between colours / numbers when there is room for it
      let gaps = 0;
      for (let i = 1; i < tiles.length; i++) if (breakKey(tiles[i]) !== breakKey(tiles[i - 1])) gaps++;
      const useGaps = tiles.length + gaps <= p.rack.length;
      p.rack.fill(null);
      let pos = 0;
      tiles.forEach((t, i) => {
        if (useGaps && i > 0 && breakKey(t) !== breakKey(tiles[i - 1]) && pos % RACK_COLS !== 0) pos++;
        p.rack[pos++] = t;
      });
    }

    // ---- table -------------------------------------------------------------

    findSets() {
      const sets = [];
      for (let r = 0; r < this.rows; r++) {
        let c = 0;
        while (c < COLS) {
          if (!this.board[r * COLS + c]) {
            c++;
            continue;
          }
          const start = c;
          const tiles = [];
          while (c < COLS && this.board[r * COLS + c]) tiles.push(this.board[r * COLS + c++]);
          sets.push(Object.assign({ row: r, col: start, idx: r * COLS + start, tiles }, E.analyzeSet(tiles)));
        }
      }
      return sets;
    }

    setAt(idx) {
      if (!this.board[idx]) return null;
      const rowStart = idx - (idx % COLS);
      let s = idx;
      while (s > rowStart && this.board[s - 1]) s--;
      let e = idx;
      while (e < rowStart + COLS - 1 && this.board[e + 1]) e++;
      return { idx: s, len: e - s + 1, tiles: this.board.slice(s, e + 1) };
    }

    fitRows() {
      let last = -1;
      for (let i = this.board.length - 1; i >= 0; i--) {
        if (this.board[i]) {
          last = Math.floor(i / COLS);
          break;
        }
      }
      const rows = Math.max(MIN_ROWS, last + 2);
      while (this.rows < rows) {
        for (let k = 0; k < COLS; k++) this.board.push(null);
        this.rows++;
      }
      while (this.rows > rows) {
        this.board.length -= COLS;
        this.rows--;
      }
    }

    isLocked(tile) {
      return this.turn.startIds.has(tile.id);
    }

    // ---- human moves -------------------------------------------------------

    // from / to: { area: 'board' | 'rack', idx }. Returns { ok, reason }.
    moveTile(playerIdx, from, to) {
      const p = this.players[playerIdx];
      const myTurn = !this.over && playerIdx === this.current;
      const touchesBoard = from.area === 'board' || to.area === 'board';
      if (touchesBoard && !myTurn) return { ok: false, reason: 'It is not your turn.' };

      const src = from.area === 'board' ? this.board : p.rack;
      const dst = to.area === 'board' ? this.board : p.rack;
      const tile = src[from.idx];
      if (!tile) return { ok: false, reason: '' };
      if (to.idx < 0 || to.idx >= dst.length) return { ok: false, reason: '' };
      if (from.area === to.area && from.idx === to.idx) return { ok: true };

      if (from.area === 'board' && this.isLocked(tile)) {
        if (to.area === 'rack') return { ok: false, reason: 'Tiles already on the table have to stay there.' };
        if (!this.turn.startMelded)
          return { ok: false, reason: 'Make your first 30-point meld before rearranging the table.' };
      }

      src[from.idx] = null;
      const cols = to.area === 'board' ? COLS : RACK_COLS;
      if (!gridInsert(dst, cols, to.idx, tile)) {
        src[from.idx] = tile;
        return { ok: false, reason: 'No room there.' };
      }
      if (touchesBoard) this.fitRows();
      return { ok: true };
    }

    canMoveSet(fromIdx) {
      if (this.over) return false;
      const set = this.setAt(fromIdx);
      if (!set) return false;
      return this.turn.startMelded || set.tiles.every((t) => !this.isLocked(t));
    }

    setFits(fromIdx, toIdx) {
      const set = this.setAt(fromIdx);
      if (!set || toIdx < 0) return false;
      const col = toIdx % COLS;
      if (col + set.len > COLS || toIdx + set.len > this.board.length) return false;
      const own = new Set(set.tiles);
      for (let i = 0; i < set.len; i++) {
        const t = this.board[toIdx + i];
        if (t && !own.has(t)) return false;
      }
      return true;
    }

    moveSet(playerIdx, fromIdx, toIdx) {
      if (this.over || playerIdx !== this.current) return { ok: false, reason: 'It is not your turn.' };
      if (!this.canMoveSet(fromIdx))
        return { ok: false, reason: 'Make your first 30-point meld before rearranging the table.' };
      if (!this.setFits(fromIdx, toIdx)) return { ok: false, reason: 'No room there.' };
      const set = this.setAt(fromIdx);
      for (let i = 0; i < set.len; i++) this.board[set.idx + i] = null;
      set.tiles.forEach((t, i) => (this.board[toIdx + i] = t));
      this.fitRows();
      return { ok: true };
    }

    placedTiles() {
      return this.board.filter((t) => t && !this.isLocked(t));
    }

    turnStatus() {
      const placed = this.placedTiles();
      const sets = this.findSets();
      const base = { canEnd: false, placed: placed.length, points: 0 };
      if (placed.length === 0) {
        return Object.assign(base, {
          msg: this.pool.length
            ? 'Drag tiles from your rack onto the table — or draw a tile.'
            : 'Drag tiles from your rack onto the table — or pass.',
        });
      }
      if (!this.turn.startMelded) {
        const mine = sets.filter((s) => s.tiles.some((t) => !this.isLocked(t)));
        if (mine.some((s) => s.tiles.some((t) => this.isLocked(t)))) {
          return Object.assign(base, { msg: 'Your first meld must be built from your own tiles only.' });
        }
        base.points = mine.reduce((sum, s) => sum + (s.valid ? s.points : 0), 0);
        if (mine.some((s) => !s.valid)) {
          return Object.assign(base, { msg: 'Sets need 3+ tiles: a run of one colour, or one number in different colours.' });
        }
        if (base.points < E.FIRST_MELD_POINTS) {
          return Object.assign(base, {
            msg: `First meld needs ${E.FIRST_MELD_POINTS} points — you have ${base.points}.`,
          });
        }
      } else if (sets.some((s) => !s.valid)) {
        return Object.assign(base, { msg: 'Every set on the table must be valid before you can end your turn.' });
      }
      return Object.assign(base, { canEnd: true, msg: 'Looks good — end your turn!' });
    }

    resetTurn() {
      const p = this.players[this.current];
      const placed = this.placedTiles();
      this.board = this.turn.startBoard.slice();
      this.rows = this.turn.startRows;
      for (const t of placed) {
        const home = this.turn.startRack.indexOf(t);
        if (home >= 0 && home < p.rack.length && !p.rack[home]) p.rack[home] = t;
        else this.addToRack(p, t);
      }
    }

    endTurn() {
      const status = this.turnStatus();
      if (!status.canEnd) return { ok: false, reason: status.msg };
      const p = this.players[this.current];
      const placed = this.placedTiles();
      p.melded = true;
      this.passes = 0;
      this.lastPlayed = new Set(placed.map((t) => t.id));
      this.lastAction = { player: p.id, type: 'play', count: placed.length };
      if (this.rackTiles(p).length === 0) this.finish(p.id, 'out');
      return { ok: true };
    }

    drawAndPass() {
      this.resetTurn();
      this.takeFromPool(this.players[this.current]);
    }

    takeFromPool(p) {
      this.lastPlayed = new Set();
      if (this.pool.length) {
        const tile = this.pool.pop();
        this.addToRack(p, tile);
        this.passes = 0;
        this.lastAction = { player: p.id, type: 'draw', tile };
      } else {
        this.passes++;
        this.lastAction = { player: p.id, type: 'pass' };
      }
    }

    // ---- AI ----------------------------------------------------------------

    playAI() {
      const p = this.players[this.current];
      const tableSets = this.findSets();
      const others = this.players.filter((o) => o !== p);
      const move = AI.computeMove({
        tableSets,
        rack: this.rackTiles(p),
        melded: p.melded,
        aggressive: this.pool.length === 0 || others.some((o) => this.rackTiles(o).length <= 3),
      });
      if (move.type === 'draw') {
        this.takeFromPool(p);
        this.sortRack(p, 'runs');
        return this.lastAction;
      }

      const kept = new Set(move.sets.filter((s) => s.keep !== null).map((s) => s.keep));
      const oldPos = new Map();
      tableSets.forEach((s, i) => {
        if (kept.has(i)) return;
        s.tiles.forEach((t, j) => {
          oldPos.set(t.id, s.idx + j);
          this.board[s.idx + j] = null;
        });
      });
      for (const s of move.sets) {
        if (s.keep !== null) continue;
        this.placeSet(s.tiles, oldPos);
      }
      const playedIds = new Set(move.played.map((t) => t.id));
      p.rack = p.rack.map((t) => (t && playedIds.has(t.id) ? null : t));
      this.sortRack(p, 'runs');
      this.fitRows();
      p.melded = true;
      this.passes = 0;
      this.lastPlayed = playedIds;
      this.lastAction = { player: p.id, type: 'play', count: move.played.length };
      if (this.rackTiles(p).length === 0) this.finish(p.id, 'out');
      return this.lastAction;
    }

    spotFree(idx, len) {
      const col = idx % COLS;
      if (idx < 0 || col + len > COLS || idx + len > this.board.length) return false;
      for (let i = 0; i < len; i++) if (this.board[idx + i]) return false;
      if (col > 0 && this.board[idx - 1]) return false;
      if (col + len < COLS && this.board[idx + len]) return false;
      return true;
    }

    placeSet(tiles, oldPos) {
      const len = tiles.length;
      let spot = -1;
      // prefer the place where part of this set already was
      const anchor = tiles.findIndex((t) => oldPos.has(t.id));
      if (anchor >= 0) {
        const at = oldPos.get(tiles[anchor].id);
        const idx = at - anchor;
        if (idx >= 0 && Math.floor(idx / COLS) === Math.floor(at / COLS) && this.spotFree(idx, len)) spot = idx;
      }
      for (let idx = 0; spot < 0; idx++) {
        if (idx >= this.board.length) {
          for (let k = 0; k < COLS; k++) this.board.push(null);
          this.rows++;
        }
        if (this.spotFree(idx, len)) spot = idx;
      }
      tiles.forEach((t, i) => (this.board[spot + i] = t));
    }

    // ---- turn order and scoring --------------------------------------------

    nextTurn() {
      if (this.over) return;
      if (this.pool.length === 0 && this.passes >= this.players.length) {
        const totals = this.players.map((p) => E.rackPenalty(this.rackTiles(p)));
        this.finish(totals.indexOf(Math.min(...totals)), 'stalemate');
        return;
      }
      this.current = (this.current + 1) % this.players.length;
      this.beginTurn();
    }

    finish(winner, reason) {
      const totals = this.players.map((p) => E.rackPenalty(this.rackTiles(p)));
      const scores = totals.map((t) => -(t - totals[winner]));
      scores[winner] = -scores.reduce((s, x) => s + x, 0);
      this.over = true;
      this.result = { winner, reason, scores, totals };
    }
  }

  const api = { Game, COLS, MIN_ROWS, RACK_COLS, gridInsert };
  if (node) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, api);
})(typeof self !== 'undefined' ? self : this);
