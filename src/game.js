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
  const SAVE_VERSION = 1;

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
        place: 0, // 1 for the first player to go out, 2 for the second, ...
      }));
      this.finishOrder = [];
      this.pool = E.shuffle(E.createTiles(), rng);
      this.current = 0;
      this.passes = 0;
      this.over = false;
      this.result = null;
      this.turn = null;
      this.lastPlayed = new Set();
      this.lastAction = null;
      this.acted = false; // the current player has finished their move
    }

    // ---- saving and loading --------------------------------------------------

    // Tiles are stored by id, which is enough to rebuild them.
    toJSON() {
      const ids = (arr) => arr.map((t) => (t ? t.id : null));
      return {
        version: SAVE_VERSION,
        rows: this.rows,
        board: ids(this.board),
        pool: ids(this.pool),
        players: this.players.map((p) => ({
          name: p.name,
          isAI: p.isAI,
          melded: p.melded,
          place: p.place,
          rack: ids(p.rack),
        })),
        current: this.current,
        passes: this.passes,
        finishOrder: this.finishOrder.slice(),
        lastPlayed: [...this.lastPlayed],
        acted: this.acted,
        over: this.over,
        result: this.result,
        turn: {
          startBoard: ids(this.turn.startBoard),
          startRows: this.turn.startRows,
          startRack: ids(this.turn.startRack),
          startMelded: this.turn.startMelded,
        },
      };
    }

    // Throws an Error with a readable message if the data is not a usable game.
    static fromJSON(data, rng = Math.random) {
      const fail = (why) => {
        throw new Error(`This file is not a valid saved game (${why}).`);
      };
      const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
      if (!data || typeof data !== 'object') fail('unreadable');
      if (data.version !== SAVE_VERSION) fail('made by a different version');
      if (!Array.isArray(data.players) || data.players.length < 2 || data.players.length > 4) fail('players');
      const n = data.players.length;
      const grid = (arr, cols, minRows) =>
        Array.isArray(arr) &&
        arr.length % cols === 0 &&
        arr.length >= cols * minRows &&
        arr.length <= cols * 60 &&
        arr.every((id) => id === null || isInt(id, 0, 105));
      if (!grid(data.board, COLS, MIN_ROWS) || data.rows !== data.board.length / COLS) fail('table');
      if (!Array.isArray(data.pool) || !data.pool.every((id) => isInt(id, 0, 105))) fail('pool');
      for (const p of data.players) {
        if (!p || typeof p.name !== 'string' || !grid(p.rack, RACK_COLS, RACK_MIN_ROWS)) fail('racks');
        if (!isInt(p.place, 0, n)) fail('places');
      }
      const seen = new Set();
      const all = data.board.concat(data.pool, ...data.players.map((p) => p.rack)).filter((id) => id !== null);
      all.forEach((id) => seen.add(id));
      if (all.length !== 106 || seen.size !== 106) fail('tiles are missing or duplicated');
      if (!isInt(data.current, 0, n - 1) || !isInt(data.passes, 0, 1000)) fail('turn order');
      const order = data.finishOrder;
      if (!Array.isArray(order) || new Set(order).size !== order.length || !order.every((i) => isInt(i, 0, n - 1)))
        fail('finishing order');
      data.players.forEach((p, i) => {
        if (p.place !== order.indexOf(i) + 1) fail('places');
      });
      const t = data.turn;
      if (!t || !grid(t.startBoard, COLS, MIN_ROWS) || t.startRows !== t.startBoard.length / COLS) fail('turn');
      if (!grid(t.startRack, RACK_COLS, RACK_MIN_ROWS)) fail('turn');
      const onBoard = new Set(data.board.filter((id) => id !== null));
      if (!t.startBoard.every((id) => id === null || onBoard.has(id))) fail('turn');
      if (!Array.isArray(data.lastPlayed) || !data.lastPlayed.every((id) => isInt(id, 0, 105))) fail('highlights');
      if (!data.over && data.players[data.current].place) fail('turn order');

      const tiles = E.createTiles();
      const back = (arr) => arr.map((id) => (id === null ? null : tiles[id]));
      const g = new Game({ players: data.players.map((p) => ({ name: p.name.slice(0, 20), isAI: !!p.isAI })) }, rng);
      g.rows = data.rows;
      g.board = back(data.board);
      g.pool = back(data.pool);
      g.players.forEach((p, i) => {
        p.rack = back(data.players[i].rack);
        p.melded = !!data.players[i].melded;
        p.place = data.players[i].place;
      });
      g.current = data.current;
      g.passes = data.passes;
      g.finishOrder = order.slice();
      g.lastPlayed = new Set(data.lastPlayed);
      g.acted = !!data.acted;
      g.turn = {
        startBoard: back(t.startBoard),
        startRows: t.startRows,
        startIds: new Set(t.startBoard.filter((id) => id !== null)),
        startRack: back(t.startRack),
        startMelded: !!t.startMelded,
      };
      if (data.over) g.finish(data.result && data.result.reason === 'stalemate' ? 'stalemate' : 'out');
      return g;
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
      this.acted = false;
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

    findSets(board = this.board, rows = this.rows) {
      const sets = [];
      for (let r = 0; r < rows; r++) {
        let c = 0;
        while (c < COLS) {
          if (!board[r * COLS + c]) {
            c++;
            continue;
          }
          const start = c;
          const tiles = [];
          while (c < COLS && board[r * COLS + c]) tiles.push(board[r * COLS + c++]);
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
      this.acted = true;
      this.passes = 0;
      this.lastPlayed = new Set(placed.map((t) => t.id));
      this.lastAction = { player: p.id, type: 'play', count: placed.length };
      this.checkOut(p);
      return { ok: true };
    }

    drawAndPass() {
      this.resetTurn();
      this.takeFromPool(this.players[this.current]);
    }

    takeFromPool(p) {
      this.acted = true;
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

    // Best move for the current player, worked out from the start of the turn.
    hint() {
      const p = this.players[this.current];
      const move = AI.computeMove({
        tableSets: this.findSets(this.turn.startBoard, this.turn.startRows),
        rack: this.rackTiles(p).concat(this.placedTiles()),
        melded: this.turn.startMelded,
        aggressive: true,
      });
      if (move.type === 'draw') return { type: 'draw' };
      return {
        type: 'play',
        played: move.played,
        sets: move.sets.filter((s) => s.keep === null).map((s) => s.tiles),
      };
    }

    // Plays the hinted move for the current player. The turn is not ended, so
    // the player can still add to it, take it back, or end the turn.
    applyHint() {
      const p = this.players[this.current];
      this.resetTurn();
      const tableSets = this.findSets();
      const move = AI.computeMove({
        tableSets,
        rack: this.rackTiles(p),
        melded: this.turn.startMelded,
        aggressive: true,
      });
      if (move.type === 'draw') return { ok: false, count: 0 };
      this.layMove(p, move, tableSets);
      return { ok: true, count: move.played.length };
    }

    // ---- AI ----------------------------------------------------------------

    playAI() {
      const p = this.players[this.current];
      const tableSets = this.findSets();
      const others = this.players.filter((o) => o !== p && !o.place);
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
      this.layMove(p, move, tableSets);
      this.sortRack(p, 'runs');
      p.melded = true;
      this.acted = true;
      this.passes = 0;
      this.lastPlayed = new Set(move.played.map((t) => t.id));
      this.lastAction = { player: p.id, type: 'play', count: move.played.length };
      this.checkOut(p);
      return this.lastAction;
    }

    // Puts a solved move on the table, leaving untouched sets where they are.
    layMove(p, move, tableSets) {
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
      this.fitRows();
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

    // The game carries on after a player goes out, until everyone has.
    checkOut(p) {
      if (this.rackTiles(p).length > 0) return;
      this.finishOrder.push(p.id);
      p.place = this.finishOrder.length;
      this.lastAction.place = p.place;
      if (this.finishOrder.length === this.players.length) this.finish('out');
    }

    nextTurn() {
      if (this.over) return;
      const active = this.players.filter((p) => !p.place);
      if (this.pool.length === 0 && this.passes >= active.length) {
        this.finish('stalemate');
        return;
      }
      do {
        this.current = (this.current + 1) % this.players.length;
      } while (this.players[this.current].place);
      this.beginTurn();
    }

    // Players who went out rank by finishing order, the rest by tiles left.
    finish(reason) {
      const totals = this.players.map((p) => E.rackPenalty(this.rackTiles(p)));
      const rest = this.players
        .filter((p) => !p.place)
        .sort((a, b) => totals[a.id] - totals[b.id])
        .map((p) => p.id);
      const ranking = this.finishOrder.concat(rest);
      this.over = true;
      this.result = { winner: ranking[0], ranking, reason, totals };
    }
  }

  const api = { Game, COLS, MIN_ROWS, RACK_COLS, gridInsert };
  if (node) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, api);
})(typeof self !== 'undefined' ? self : this);
