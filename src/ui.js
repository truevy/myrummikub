// Rendering, drag and drop, and the turn loop.
(function () {
  const { Game, COLS, RACK_COLS, FIRST_MELD_POINTS } = RK;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const AI_NAMES = ['Ava', 'Max', 'Zoe', 'Leo'];
  const AI_FACES = ['🤖', '👾', '🦊', '🐙'];
  const HUMAN_FACES = ['😀', '😎', '🤠', '🧐'];
  const PLAYER_COLORS = ['#ffd166', '#4cc9f0', '#ff8fa3', '#95d5b2'];
  const RACK_PAD_X = 10;
  const RACK_PAD_Y = 8;

  const layer = $('#tiles');
  const overlay = $('#overlay');
  const boardEl = $('#board');
  const rackEl = $('#rack');

  let game = null;
  let config = null;
  let view = null; // index of the player whose rack is shown
  let busy = true; // true while the human may not act
  let paused = false;
  let speed = 1;
  let soundOn = true;
  let thinking = -1;
  let statusOverride = null;
  let turnToken = 0; // bumped on every new game to stop stale async loops
  let drag = null;
  let cw = 50;
  let ch = 66;
  let rects = {};
  const tileEls = new Map();
  let dropmark = null;

  // ---- sound ---------------------------------------------------------------

  let audio = null;
  function tone(from, to, dur, vol, delay = 0) {
    if (!soundOn) return;
    try {
      audio = audio || new AudioContext();
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (err) {
      /* audio is optional */
    }
  }
  const clack = (n = 1) => {
    for (let i = 0; i < Math.min(n, 6); i++) tone(950, 200, 0.07, 0.16, i * 0.07);
  };
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.3, 0.14, i * 0.13));

  // ---- helpers -------------------------------------------------------------

  const humans = () => config.players.filter((p) => !p.isAI).length;
  const current = () => game.players[game.current];
  const humanTurn = () => game && !game.over && !busy && view === game.current && !current().isAI;
  const face = (i) => config.players[i].face;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function wait(ms) {
    const end = Date.now() + ms * speed;
    while (Date.now() < end || paused) await sleep(40);
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function miniTile(t, small) {
    const cls = t.joker ? 'joker' : 'c' + t.color;
    return `<span class="mini ${cls}${small ? ' small' : ''}">${t.joker ? '☻' : t.value}</span>`;
  }

  // ---- layout and rendering ------------------------------------------------

  function viewRackRows() {
    return view === null ? 2 : game.players[view].rack.length / RACK_COLS;
  }

  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rackRows = viewRackRows();
    const byHeight = ((H - 190) / (game.rows + rackRows)) * 0.76;
    const byBoard = (W - 40) / COLS;
    const byRack = (W - 2 * 166 - 52) / RACK_COLS;
    cw = Math.max(22, Math.min(64, Math.floor(Math.min(byHeight, byBoard, byRack))));
    ch = Math.round(cw / 0.76);
    const root = document.documentElement.style;
    root.setProperty('--cw', cw + 'px');
    root.setProperty('--ch', ch + 'px');
    root.setProperty('--rows', game.rows);
    root.setProperty('--rack-rows', rackRows);
    rects = {
      board: boardEl.getBoundingClientRect(),
      rack: rackEl.getBoundingClientRect(),
      pool: $('#pool .pool-stack').getBoundingClientRect(),
      panels: game.players.map((_, i) => $('#panel-' + i).getBoundingClientRect()),
    };
  }

  function buildPlayers() {
    $('#players').innerHTML = game.players
      .map(
        (p, i) => `
        <div class="player" id="panel-${i}" style="--pc:${PLAYER_COLORS[i]}">
          <div class="avatar">${face(i)}</div>
          <div>
            <div class="name">${esc(p.name)}</div>
            <div class="meta"><span class="count"></span><span class="badge"></span></div>
          </div>
          <div class="thinking"><i></i><i></i><i></i></div>
        </div>`
      )
      .join('');
  }

  function buildTiles() {
    layer.innerHTML = '<div id="dropmark"></div>';
    dropmark = $('#dropmark');
    tileEls.clear();
    const all = game.pool.concat(game.board.filter(Boolean));
    game.players.forEach((p) => all.push(...game.rackTiles(p)));
    for (const t of all) {
      const el = document.createElement('div');
      el.className = 'tile hidden ' + (t.joker ? 'joker' : 'c' + t.color);
      el.dataset.id = t.id;
      el.innerHTML = t.joker
        ? '<span class="num">☻</span><span class="ring">JOKER</span>'
        : `<span class="num">${t.value}</span><span class="ring"></span>`;
      layer.appendChild(el);
      tileEls.set(t.id, el);
    }
  }

  function renderPlayers() {
    game.players.forEach((p, i) => {
      const el = $('#panel-' + i);
      el.classList.toggle('active', !game.over && game.turn !== null && i === game.current);
      el.classList.toggle('thinking', i === thinking);
      el.querySelector('.count').textContent = game.rackTiles(p).length;
      const badge = el.querySelector('.badge');
      badge.textContent = p.melded ? 'MELDED' : 'NO MELD';
      badge.className = 'badge ' + (p.melded ? 'yes' : 'no');
    });
    $('#pool-count').textContent = game.pool.length;
  }

  function renderSets() {
    boardEl.querySelectorAll('.set-outline').forEach((el) => el.remove());
    layer.querySelectorAll('.set-handle').forEach((el) => el.remove());
    const mine = humanTurn();
    boardEl.classList.toggle('my-turn', mine);
    for (const s of game.findSets()) {
      const el = document.createElement('div');
      const state = s.valid ? 'valid' : s.tiles.length < 3 ? 'pending' : 'invalid';
      el.className = 'set-outline ' + state;
      el.style.left = s.col * cw + 'px';
      el.style.top = s.row * ch + 'px';
      el.style.width = s.tiles.length * cw + 'px';
      el.style.height = ch + 'px';
      const isNew = game.turn && s.tiles.every((t) => !game.isLocked(t));
      if (mine && s.valid && isNew && !game.turn.startMelded) {
        el.innerHTML = `<span class="pts">${s.points}</span>`;
      }
      boardEl.appendChild(el);

      if (mine && game.canMoveSet(s.idx)) {
        const h = document.createElement('div');
        h.className = 'set-handle';
        h.dataset.idx = s.idx;
        h.title = 'Drag to move the whole set';
        const x = rects.board.left + s.col * cw + (s.tiles.length * cw) / 2 - 15;
        const y = rects.board.top + s.row * ch - 6;
        h.style.transform = `translate(${x}px, ${y}px)`;
        layer.appendChild(h);
      }
    }
  }

  function renderControls() {
    const mine = humanTurn();
    const status = mine ? game.turnStatus() : null;
    const viewedHuman = view !== null && !game.players[view].isAI && !game.over;
    $('#btn-sort-runs').disabled = !viewedHuman;
    $('#btn-sort-groups').disabled = !viewedHuman;
    $('#btn-reset').disabled = !mine || status.placed === 0;
    $('#btn-draw').disabled = !mine;
    $('#btn-end').disabled = !mine || !status.canEnd;
    $('#btn-draw').textContent = !game.pool.length ? 'Pass' : status && status.placed ? 'Take back & draw' : 'Draw tile';
    document.querySelectorAll('.side').forEach((el) => (el.style.visibility = humans() ? 'visible' : 'hidden'));

    let text = '';
    if (statusOverride !== null) text = statusOverride;
    else if (mine) text = (humans() === 1 ? 'Your turn. ' : `${current().name}'s turn. `) + status.msg;
    $('#status-text').textContent = text;

    const meter = $('#meld-meter');
    const showMeter = mine && statusOverride === null && !game.turn.startMelded && status.placed > 0;
    meter.classList.toggle('show', !!showMeter);
    if (showMeter) {
      meter.innerHTML = `<i style="width:${Math.min(100, (status.points / FIRST_MELD_POINTS) * 100)}%"></i>`;
    }

    let label = '';
    if (view === null) label = humans() > 1 ? 'Rack hidden' : '';
    else if (game.players[view].isAI) label = '';
    $('#rack-label').textContent = label;
  }

  function positionTiles(opts) {
    const target = new Map();
    const tuck = (rect, key) => ({
      x: rect.left + rect.width / 2 - cw / 2,
      y: rect.top + rect.height / 2 - ch / 2,
      hidden: true,
      key,
    });
    game.pool.forEach((t) => target.set(t.id, tuck(rects.pool, 'pool')));
    game.players.forEach((p, pi) => {
      p.rack.forEach((t, i) => {
        if (!t) return;
        if (pi !== view) return target.set(t.id, tuck(rects.panels[pi], 'h' + pi));
        target.set(t.id, {
          x: rects.rack.left + RACK_PAD_X + (i % RACK_COLS) * cw + 2,
          y: rects.rack.top + RACK_PAD_Y + Math.floor(i / RACK_COLS) * ch + 2,
          key: 'r' + pi + ':' + i,
          movable: !p.isAI && !game.over,
        });
      });
    });
    const mine = humanTurn();
    const humanNow = game.turn && !current().isAI;
    game.board.forEach((t, i) => {
      if (!t) return;
      const locked = game.turn ? game.isLocked(t) : true;
      target.set(t.id, {
        x: rects.board.left + (i % COLS) * cw + 2,
        y: rects.board.top + Math.floor(i / COLS) * ch + 2,
        key: 'b' + i,
        movable: mine && (!locked || game.turn.startMelded),
        fresh: humanNow && !locked,
        last: game.lastPlayed.has(t.id),
      });
    });

    let n = 0;
    for (const [id, el] of tileEls) {
      const tg = target.get(id);
      if (!tg) continue;
      const moved = el._key !== tg.key;
      el.style.transitionDelay = opts.stagger && moved ? Math.min(n++ * 40, 1000) + 'ms' : '0ms';
      el.style.transform = `translate(${tg.x}px, ${tg.y}px)` + (tg.hidden ? ' scale(.35)' : '');
      el.style.zIndex = moved ? 10 : 2;
      el.classList.toggle('hidden', !!tg.hidden);
      el.classList.toggle('fixed', !tg.movable);
      el.classList.toggle('fresh', !!tg.fresh);
      el.classList.toggle('last', !!tg.last && !tg.fresh);
      el._key = tg.key;
      el._x = tg.x;
      el._y = tg.y;
    }
  }

  function render(opts = {}) {
    if (!game) return;
    layout();
    renderPlayers();
    renderSets();
    renderControls();
    positionTiles(opts);
  }

  function renderInstant() {
    layer.classList.add('no-anim');
    render();
    void layer.offsetWidth;
    layer.classList.remove('no-anim');
  }

  // ---- drag and drop -------------------------------------------------------

  function locate(id) {
    const b = game.board.findIndex((t) => t && t.id === id);
    if (b >= 0) return { area: 'board', idx: b };
    if (view === null) return null;
    const r = game.players[view].rack.findIndex((t) => t && t.id === id);
    return r >= 0 ? { area: 'rack', idx: r } : null;
  }

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
  }

  function startSetDrag(setIdx, e) {
    const set = game.setAt(setIdx);
    const items = set.tiles.map((t, i) => ({ el: tileEls.get(t.id), dx: i * cw }));
    const first = items[0].el;
    drag = { kind: 'set', fromIdx: set.idx, len: set.len, items, offX: e.clientX - first._x, offY: e.clientY - first._y };
    beginDrag(e);
  }

  function beginDrag(e) {
    drag.items.forEach((it) => it.el.classList.add('dragging'));
    layer.querySelectorAll('.set-handle').forEach((el) => el.remove());
    moveDrag(e);
  }

  function onDown(e) {
    if (e.button !== 0 || drag || !game || game.over) return;
    const handle = e.target.closest('.set-handle');
    if (handle) {
      if (humanTurn()) startSetDrag(+handle.dataset.idx, e);
      return;
    }
    const el = e.target.closest('.tile');
    if (!el) return;
    const loc = locate(+el.dataset.id);
    if (!loc) return;
    if (loc.area === 'rack' && game.players[view].isAI) return;
    if (loc.area === 'board') {
      if (!humanTurn()) return;
      const tile = game.board[loc.idx];
      if (game.isLocked(tile) && !game.turn.startMelded) {
        shake(el);
        toast(`Make your first ${FIRST_MELD_POINTS}-point meld before rearranging the table.`);
        return;
      }
      if (e.shiftKey && game.canMoveSet(loc.idx)) {
        const set = game.setAt(loc.idx);
        startSetDrag(set.idx, e);
        drag.offX += (loc.idx - set.idx) * cw;
        moveDrag(e);
        return;
      }
    }
    drag = { kind: 'tile', from: loc, items: [{ el, dx: 0 }], offX: e.clientX - el._x, offY: e.clientY - el._y };
    beginDrag(e);
  }

  function dropTarget(e) {
    const x = e.clientX - drag.offX + (cw - 4) / 2;
    const y = e.clientY - drag.offY + (ch - 4) / 2;
    const b = rects.board;
    if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) {
      if (!humanTurn()) return null;
      let col = Math.floor((x - b.left) / cw);
      const row = Math.floor((y - b.top) / ch);
      if (drag.kind === 'set') col = Math.min(col, COLS - drag.len);
      const idx = row * COLS + col;
      const len = drag.kind === 'set' ? drag.len : 1;
      const bad = drag.kind === 'set' && !game.setFits(drag.fromIdx, idx);
      return { area: 'board', idx, bad, x: b.left + col * cw, y: b.top + row * ch, w: len * cw };
    }
    if (drag.kind !== 'tile') return null;
    const r = rects.rack;
    const rx = x - r.left - RACK_PAD_X;
    const ry = y - r.top - RACK_PAD_Y;
    const rows = viewRackRows();
    if (rx >= -cw / 2 && rx < RACK_COLS * cw + cw / 2 && ry >= -ch / 2 && ry < rows * ch + ch / 2) {
      const col = Math.max(0, Math.min(RACK_COLS - 1, Math.floor(rx / cw)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(ry / ch)));
      const bad = drag.from.area === 'board' && game.isLocked(game.board[drag.from.idx]);
      return {
        area: 'rack',
        idx: row * RACK_COLS + col,
        bad,
        x: r.left + RACK_PAD_X + col * cw,
        y: r.top + RACK_PAD_Y + row * ch,
        w: cw,
      };
    }
    return null;
  }

  function moveDrag(e) {
    for (const it of drag.items) {
      const x = e.clientX - drag.offX + it.dx;
      const y = e.clientY - drag.offY;
      it.el.style.transitionDelay = '0ms';
      it.el.style.transform = `translate(${x}px, ${y}px) rotate(${drag.kind === 'set' ? 0 : 3}deg) scale(1.08)`;
    }
    const tg = dropTarget(e);
    if (!tg) {
      dropmark.style.display = 'none';
      return;
    }
    dropmark.style.display = 'block';
    dropmark.classList.toggle('bad', !!tg.bad);
    dropmark.style.transform = `translate(${tg.x}px, ${tg.y}px)`;
    dropmark.style.width = tg.w + 'px';
    dropmark.style.height = ch + 'px';
  }

  function onMove(e) {
    if (drag) moveDrag(e);
  }

  function onUp(e) {
    if (!drag) return;
    const tg = dropTarget(e);
    drag.items.forEach((it) => it.el.classList.remove('dragging'));
    dropmark.style.display = 'none';
    if (tg) {
      const res =
        drag.kind === 'tile'
          ? game.moveTile(view, drag.from, { area: tg.area, idx: tg.idx })
          : game.moveSet(view, drag.fromIdx, tg.idx);
      if (res.ok) clack(drag.items.length);
      else if (res.reason) toast(res.reason);
    }
    drag = null;
    render();
  }

  layer.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', renderInstant);

  // ---- turn loop -----------------------------------------------------------

  function describe(action) {
    const p = game.players[action.player];
    const who = humans() === 1 && !p.isAI ? 'You' : p.name;
    if (action.type === 'play') {
      const out = game.rackTiles(p).length === 0;
      return `${who} played ${action.count} tile${action.count === 1 ? '' : 's'}${out ? ' — and went out!' : '.'}`;
    }
    if (action.type === 'draw') return `${who} drew a tile.`;
    return `${who} passed.`;
  }

  async function runTurn() {
    const token = turnToken;
    if (game.over) return showGameOver();
    const p = current();

    if (p.isAI) {
      busy = true;
      if (humans() === 0) view = game.current;
      thinking = game.current;
      statusOverride = `${p.name} is thinking…`;
      render({ stagger: true });
      await wait(1000);
      if (token !== turnToken) return;
      const action = game.playAI();
      thinking = -1;
      statusOverride = describe(action);
      clack(action.type === 'play' ? action.count : 1);
      render({ stagger: true });
      await wait(action.type === 'play' ? 1700 : 800);
      if (token !== turnToken) return;
      if (!game.over) game.nextTurn();
      return runTurn();
    }

    if (humans() > 1) {
      view = null;
      busy = true;
      statusOverride = '';
      render();
      await showCurtain(p);
      if (token !== turnToken) return;
    }
    statusOverride = null;
    view = game.current;
    busy = false;
    render({ stagger: humans() > 1 });
  }

  async function afterHumanAction() {
    const token = turnToken;
    busy = true;
    statusOverride = describe(game.lastAction);
    render();
    await sleep(game.lastAction.type === 'draw' ? 1100 : 700);
    if (token !== turnToken) return;
    if (!game.over) game.nextTurn();
    runTurn();
  }

  $('#btn-end').addEventListener('click', () => {
    if (!humanTurn()) return;
    const res = game.endTurn();
    if (!res.ok) return toast(res.reason);
    clack(2);
    afterHumanAction();
  });

  $('#btn-draw').addEventListener('click', () => {
    if (!humanTurn()) return;
    game.drawAndPass();
    clack();
    afterHumanAction();
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!humanTurn()) return;
    game.resetTurn();
    render({ stagger: true });
  });

  for (const [id, mode] of [['#btn-sort-runs', 'runs'], ['#btn-sort-groups', 'groups']]) {
    $(id).addEventListener('click', () => {
      if (view === null || game.players[view].isAI || game.over) return;
      game.sortRack(game.players[view], mode);
      render();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter' && humanTurn() && game.turnStatus().canEnd) $('#btn-end').click();
  });

  // ---- tools ---------------------------------------------------------------

  document.querySelectorAll('[data-speed]').forEach((btn) =>
    btn.addEventListener('click', () => {
      speed = +btn.dataset.speed;
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', b === btn));
    })
  );

  $('#btn-pause').addEventListener('click', () => {
    paused = !paused;
    $('#btn-pause').textContent = paused ? '▶' : '⏸';
    $('#btn-pause').classList.toggle('on', paused);
  });

  $('#btn-sound').addEventListener('click', () => {
    soundOn = !soundOn;
    $('#btn-sound').textContent = soundOn ? '🔊' : '🔇';
  });

  $('#btn-menu').addEventListener('click', () => {
    if (!game || game.over) return showSetup();
    const wasPaused = paused;
    paused = true;
    showCard(
      `<h2>Leave this game?</h2><p>The current game will be lost.</p>
       <div class="actions">
         <button class="btn big" id="stay">Keep playing</button>
         <button class="btn big primary" id="leave">New game</button>
       </div>`,
      true
    );
    $('#stay').onclick = () => {
      paused = wasPaused;
      hideOverlay();
    };
    $('#leave').onclick = () => {
      paused = false;
      $('#btn-pause').textContent = '⏸';
      $('#btn-pause').classList.remove('on');
      showSetup();
    };
  });

  // ---- overlays ------------------------------------------------------------

  function showCard(html, glass) {
    overlay.className = 'show' + (glass ? ' glass' : '');
    overlay.innerHTML = `<div class="card">${html}</div>`;
  }

  function hideOverlay() {
    overlay.className = '';
    overlay.innerHTML = '';
  }

  const setup = { humans: 1, ais: 2, names: ['You', 'Player 2', 'Player 3', 'Player 4'] };

  function showSetup() {
    turnToken++;
    game = null;
    layer.innerHTML = '';
    const logo = 'RUMMIKUB'
      .split('')
      .map((c, i) => `<span class="mini c${i % 4}" style="animation-delay:${i * 60}ms">${c}</span>`)
      .join('');
    showCard(`
      <div class="logo">${logo}</div>
      <p>Choose who sits at the table — 2 to 4 players in total.</p>
      <div class="steppers">
        <div class="stepper">
          <div class="icon">🧑</div><div class="label">Human players</div>
          <div class="row"><button class="round" data-k="humans" data-d="-1">−</button><div class="val" id="v-humans"></div><button class="round" data-k="humans" data-d="1">+</button></div>
        </div>
        <div class="stepper">
          <div class="icon">🤖</div><div class="label">AI players</div>
          <div class="row"><button class="round" data-k="ais" data-d="-1">−</button><div class="val" id="v-ais"></div><button class="round" data-k="ais" data-d="1">+</button></div>
        </div>
      </div>
      <div class="names" id="names"></div>
      <p class="hint" id="hint"></p>
      <button class="btn primary big" id="start">Start game</button>
    `);

    const refresh = () => {
      const total = setup.humans + setup.ais;
      $('#v-humans').textContent = setup.humans;
      $('#v-ais').textContent = setup.ais;
      overlay.querySelectorAll('.round').forEach((b) => {
        const d = +b.dataset.d;
        const v = setup[b.dataset.k] + d;
        b.disabled = v < 0 || total + d > 4 || total + d < 2;
      });
      if (setup.humans === 1 && setup.names[0] === 'Player 1') setup.names[0] = 'You';
      if (setup.humans > 1 && setup.names[0] === 'You') setup.names[0] = 'Player 1';
      $('#names').innerHTML = setup.names
        .slice(0, setup.humans)
        .map((n, i) => `<input maxlength="12" data-i="${i}" value="${esc(n)}" placeholder="Player ${i + 1}">`)
        .join('');
      $('#hint').textContent =
        setup.humans === 0
          ? 'Spectator mode — sit back and watch the AIs battle it out.'
          : setup.humans === 1
            ? `You against ${setup.ais} AI opponent${setup.ais === 1 ? '' : 's'}.`
            : 'Hot-seat mode — racks are hidden while you pass the device.';
    };
    overlay.querySelectorAll('.round').forEach((b) =>
      b.addEventListener('click', () => {
        setup[b.dataset.k] += +b.dataset.d;
        refresh();
      })
    );
    $('#names').addEventListener('input', (e) => {
      setup.names[+e.target.dataset.i] = e.target.value;
    });
    $('#start').addEventListener('click', () => {
      const players = [];
      for (let i = 0; i < setup.humans; i++) {
        players.push({ name: setup.names[i].trim() || `Player ${i + 1}`, isAI: false, face: HUMAN_FACES[i] });
      }
      for (let i = 0; i < setup.ais; i++) players.push({ name: AI_NAMES[i], isAI: true, face: AI_FACES[i] });
      startGame({ players });
    });
    refresh();
  }

  async function startGame(cfg) {
    const token = ++turnToken;
    config = cfg;
    game = new Game({ players: cfg.players });
    view = null;
    busy = true;
    thinking = -1;
    statusOverride = '';
    buildPlayers();
    buildTiles();
    const draws = game.pickFirstPlayer();
    renderInstant();
    await showFirstPick(draws, token);
    if (token !== turnToken) return;
    hideOverlay();
    game.deal();
    game.beginTurn();
    if (humans() === 0) view = game.current;
    else if (humans() === 1) view = game.players.findIndex((p) => !p.isAI);
    statusOverride = 'Dealing 14 tiles to every player…';
    clack(6);
    render({ stagger: true });
    await sleep(1500);
    if (token !== turnToken) return;
    runTurn();
  }

  async function showFirstPick(draws, token) {
    showCard(`
      <h2 id="pick-title">Who goes first?</h2>
      <p id="pick-sub">Everyone draws a tile — the highest number starts.</p>
      <div class="draws">
        ${draws
          .map(
            (t, i) => `
          <div class="draw" id="draw-${i}" style="--pc:${PLAYER_COLORS[i]}">
            <div class="crown">👑</div>
            <div class="flip"><div class="inner">
              <div class="face back"></div>
              <div class="face front mini c${t.color}" style="width:100%;height:100%">${t.value}</div>
            </div></div>
            <div class="avatar">${face(i)}</div>
            <div class="who">${esc(game.players[i].name)}</div>
          </div>`
          )
          .join('')}
      </div>
    `);
    for (let i = 0; i < draws.length; i++) {
      await sleep(700);
      if (token !== turnToken) return;
      $(`#draw-${i} .flip`).classList.add('open');
      clack();
    }
    await sleep(900);
    if (token !== turnToken) return;
    draws.forEach((_, i) => $('#draw-' + i).classList.add(i === game.current ? 'won' : 'lost'));
    const p = current();
    $('#pick-title').textContent = humans() === 1 && !p.isAI ? 'You go first!' : `${p.name} goes first!`;
    $('#pick-sub').textContent = `Highest tile: ${draws[game.current].value}`;
    tone(660, 990, 0.25, 0.15);
    await sleep(2000);
  }

  function showCurtain(p) {
    return new Promise((resolve) => {
      showCard(
        `<div class="logo"><span class="mini c1" style="font-size:30px">${face(p.id)}</span></div>
         <h2>${esc(p.name)}, it's your turn</h2>
         <p>Pass the device — the rack stays hidden until you are ready.</p>
         <button class="btn primary big" id="ready">Show my tiles</button>`,
        true
      );
      $('#ready').onclick = () => {
        hideOverlay();
        resolve();
      };
    });
  }

  function showGameOver() {
    busy = true;
    thinking = -1;
    statusOverride = '';
    render();
    const { winner, reason, scores } = game.result;
    const w = game.players[winner];
    const youWon = humans() === 1 && !w.isAI;
    const title = youWon ? 'You win!' : `${esc(w.name)} wins!`;
    const sub =
      reason === 'out'
        ? 'Every tile played — rack cleared.'
        : 'The pool ran dry and nobody could move. Lowest rack wins.';
    const order = game.players.map((p, i) => i).sort((a, b) => scores[b] - scores[a]);
    showCard(
      `<div class="logo"><span class="mini c3" style="font-size:32px">🏆</span></div>
       <h1>${title}</h1><p>${sub}</p>
       <div class="scores">
        ${order
          .map((i) => {
            const p = game.players[i];
            const left = game.rackTiles(p);
            return `<div class="score-row ${i === winner ? 'winner' : ''}" style="--pc:${PLAYER_COLORS[i]}">
              <div class="avatar">${face(i)}</div>
              <div class="name">${esc(p.name)}</div>
              <div class="left">${left.length ? left.map((t) => miniTile(t, true)).join('') : 'No tiles left'}</div>
              <div class="score ${scores[i] >= 0 ? 'plus' : 'minus'}">${scores[i] > 0 ? '+' : ''}${scores[i]}</div>
            </div>`;
          })
          .join('')}
       </div>
       <div class="actions">
         <button class="btn big" id="again">Rematch</button>
         <button class="btn big primary" id="fresh">New game</button>
       </div>`,
      true
    );
    const colors = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#f08a00', '#fff'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 300 - 150).toFixed(0) + 'px');
      c.style.setProperty('--rot', (Math.random() * 1400 - 700).toFixed(0) + 'deg');
      c.style.animationDuration = (2.5 + Math.random() * 3).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's';
      overlay.appendChild(c);
    }
    fanfare();
    $('#again').onclick = () => startGame(config);
    $('#fresh').onclick = showSetup;
  }

  window.__rk = {
    get game() {
      return game;
    },
    render,
  };

  showSetup();
})();
