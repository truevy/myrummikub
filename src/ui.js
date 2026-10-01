// Rendering, drag and drop, and the turn loop.
(function () {
  const { Game, COLS, RACK_COLS, FIRST_MELD_POINTS } = RK;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const AI_NAMES = [
    'Nina', 'Sara', 'Jackie', 'Christina', 'Alex', 'Enis', 'Mark',
    'Layla', 'Zac', 'Hannah', 'Bilbo', 'Emily', 'Kookie',
  ];
  const AI_FACES = ['🤖', '👾', '🦊', '🐙'];
  const HUMAN_FACES = ['😀', '😎', '🤠', '🧐'];
  const FACE_CHOICES = ['😀', '😎', '🤠', '🧐', '🥸', '🤓', '😺', '🦄', '🐻', '🐸', '🦁', '🐼', '🐨', '🦉', '🌞', '🌈', '🍀', '🎩', '👑', '🚀'];
  const PLAYER_COLORS = ['#ffd166', '#4cc9f0', '#ff8fa3', '#95d5b2'];
  const RACK_PAD_X = 10;
  const RACK_PAD_Y = 8;
  const RACK_LIFT = 82; // extra room under the rack (see #bottom in the stylesheet)

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
  let thinking = -1;
  let statusOverride = null;
  let turnToken = 0; // bumped on every new game to stop stale async loops
  let drag = null;
  let cw = 50;
  let ch = 66;
  let rects = {};
  const tileEls = new Map();
  const tileById = new Map();
  let dropmark = null;
  let hintIds = new Set();
  let scene = null; // a replayed board shown instead of the live one
  let replayToken = 0;
  let pausedBeforeReplay = false;
  let lastDown = { id: -1, t: 0 };

  // ---- settings ------------------------------------------------------------

  const P = RK.profiles;
  const C = RK.cloud;
  const L = RK.lobby;
  const SY = RK.sync;
  const LEGACY_SETTINGS_KEY = 'lyndas-rummikub-settings';
  const TURN_SOUNDS = {
    chime: 'Soft chime',
    wood: 'Wood knock',
    marimba: 'Marimba',
    zing: 'Low zing',
  };
  const ASSIST = {
    off: 'Off — no help until I click Hint',
    any: 'Tell me whether I have a move',
    count: 'Tell me how many tiles I could play',
    out: 'Tell me whether I can go out this turn',
    hint: 'Show me the full hint every turn',
  };
  const DEFAULT_CHEER = 'Scrabalicious!';
  const settings = {
    sound: 'chime',
    volume: 0.7,
    mute: false,
    assist: 'off',
    celebrateTiles: 8,
    celebrateText: DEFAULT_CHEER,
    currentGame: null, // the online game this computer is part of, for rejoining after a restart
    hostedGames: [], // online games started here, so they can be tidied away later
  };

  // In the app, settings and profiles are JSON files in the app's data folder.
  // In a plain browser they fall back to local storage.
  const store = {
    async read(name) {
      try {
        if (window.rkStore) return await window.rkStore.read(name);
        return JSON.parse(localStorage.getItem('lyndas-rummikub-' + name));
      } catch (err) {
        return null;
      }
    },
    async write(name, data) {
      try {
        if (window.rkStore) await window.rkStore.write(name, data);
        else localStorage.setItem('lyndas-rummikub-' + name, JSON.stringify(data));
      } catch (err) {
        toast('Could not save ' + name + ': ' + err.message);
      }
    },
  };

  function applySettings(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (TURN_SOUNDS[saved.sound]) settings.sound = saved.sound;
    if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) settings.volume = saved.volume;
    if (typeof saved.mute === 'boolean') settings.mute = saved.mute;
    if (ASSIST[saved.assist]) settings.assist = saved.assist;
    if (Number.isInteger(saved.celebrateTiles) && saved.celebrateTiles >= 2 && saved.celebrateTiles <= 30) settings.celebrateTiles = saved.celebrateTiles;
    if (typeof saved.celebrateText === 'string' && saved.celebrateText.trim()) settings.celebrateText = saved.celebrateText.trim().slice(0, 30);
    if (RK.lobby.isId(saved.currentGame)) settings.currentGame = saved.currentGame;
    if (Array.isArray(saved.hostedGames)) settings.hostedGames = saved.hostedGames.filter(RK.lobby.isId).slice(-20);
  }
  const saveSettings = () => store.write('settings', settings);

  let db = P.emptyDb(); // registered players and the ledger of finished games
  const saveDb = () => store.write('profiles', db);

  // ---- sound ---------------------------------------------------------------

  let audio = null;
  let master = null;
  function out() {
    audio = audio || new AudioContext();
    if (!master) {
      master = audio.createGain();
      master.connect(audio.destination);
    }
    master.gain.value = settings.mute ? 0 : settings.volume * settings.volume;
    return master;
  }
  const soundOn = () => !settings.mute && settings.volume > 0;

  function tone(from, to, dur, vol, delay = 0, type = 'triangle') {
    if (!soundOn()) return;
    try {
      const dest = out();
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (err) {
      /* audio is optional */
    }
  }
  // a sustained note with a soft attack, for chords
  function pad(freq, dur, vol, delay = 0, type = 'sine') {
    if (!soundOn()) return;
    try {
      const dest = out();
      const t = audio.currentTime + delay;
      const g = audio.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.12);
      g.gain.setValueAtTime(vol, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      g.connect(dest);
      for (const detune of [-4, 4]) {
        const o = audio.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    } catch (err) {
      /* audio is optional */
    }
  }

  const clack = (n = 1) => {
    for (let i = 0; i < Math.min(n, 6); i++) tone(950, 200, 0.07, 0.16, i * 0.07);
  };

  // The four end-of-turn sounds, all pitched around the middle of the keyboard.
  const turnSounds = {
    chime: () => {
      tone(523, 523, 0.35, 0.16, 0, 'sine');
      tone(659, 659, 0.55, 0.14, 0.16, 'sine');
      tone(1046, 1046, 0.4, 0.04, 0.16, 'sine');
    },
    wood: () => {
      for (const d of [0, 0.19]) {
        tone(190, 60, 0.14, 0.7, d, 'sine');
        tone(700, 250, 0.03, 0.1, d, 'square');
      }
    },
    marimba: () => {
      [392, 330, 262].forEach((f, i) => {
        tone(f, f * 0.995, 0.28, 0.2, i * 0.11, 'triangle');
        tone(f * 4, f * 4, 0.05, 0.05, i * 0.11, 'sine');
      });
    },
    zing: () => {
      tone(220, 880, 0.18, 0.18, 0, 'sine');
      [659, 830, 988].forEach((f, i) => tone(f, f * 1.005, 0.45 - i * 0.05, 0.1, 0.15 + i * 0.03, 'sine'));
    },
  };
  const turnSound = () => (turnSounds[settings.sound] || turnSounds.chime)();

  // a small two-syllable cheer: a sung "wa" sliding up into a long "hoo"
  function wahoo(delay = 0) {
    if (!soundOn()) return;
    try {
      const dest = out();
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const vib = audio.createOscillator();
      const vibGain = audio.createGain();
      const f = audio.createBiquadFilter();
      const g = audio.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(460, t + 0.16);
      o.frequency.setValueAtTime(560, t + 0.24);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.42);
      o.frequency.exponentialRampToValueAtTime(760, t + 0.85);
      vib.frequency.value = 7;
      vibGain.gain.setValueAtTime(0, t);
      vibGain.gain.setValueAtTime(14, t + 0.45);
      vib.connect(vibGain).connect(o.frequency);
      f.type = 'bandpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(600, t);
      f.frequency.exponentialRampToValueAtTime(1300, t + 0.16);
      f.frequency.setValueAtTime(900, t + 0.24);
      f.frequency.exponentialRampToValueAtTime(420, t + 0.5);
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.21);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(f).connect(g).connect(dest);
      o.start(t);
      vib.start(t);
      o.stop(t + 0.95);
      vib.stop(t + 0.95);
    } catch (err) {
      /* audio is optional */
    }
  }

  // a quick glittering run for a big turn
  const celebration = () => {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, f * 1.01, 0.35, 0.12, i * 0.07, 'triangle'));
    [1046, 1318, 1568].forEach((f, i) => pad(f, 1.1, 0.06, 0.45 + i * 0.05));
  };

  // a stately, unhurried cadence for the winner: four slow chords that
  // settle on a warm final major chord
  const victory = () => {
    const chords = [
      [262, 330, 392, 523],
      [349, 440, 523, 698],
      [392, 494, 587, 784],
      [262, 330, 392, 523, 659],
    ];
    chords.forEach((chord, i) => {
      const last = i === chords.length - 1;
      chord.forEach((f, k) => pad(f, last ? 2.6 : 0.85, last ? 0.1 : 0.08, i * 0.75 + k * 0.01, k === 0 ? 'triangle' : 'sine'));
    });
  };

  // ---- helpers -------------------------------------------------------------

  const humans = () => config.players.filter((p) => !p.isAI && !p.remote).length; // people at this computer
  // "You" reads right only when exactly one person plays from this computer
  const isMe = (i) => humans() === 1 && !config.players[i].isAI && !config.players[i].remote;
  const current = () => game.players[game.current];
  const humanTurn = () => game && !game.over && !busy && !scene && view === game.current && !current().isAI;
  const boardNow = () => (scene ? scene.board : game.board);
  const rowsNow = () => (scene ? scene.rows : game.rows);
  const LEVEL_DOTS = (lvl) => '●'.repeat(lvl) + '○'.repeat(5 - lvl);
  const levelName = (lvl) => (RK.LEVELS[lvl] ? RK.LEVELS[lvl].name : '');
  // a player's picture: their photo if they have one, otherwise their emoji
  const avatarHtml = (p) => (p.photo && P.isPhoto(p.photo) ? `<img class="photo" src="${p.photo}" alt="">` : p.face);
  const face = (i) => avatarHtml(config.players[i]);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function statsLine(profileId) {
    const st = P.statsFor(db, profileId);
    if (!st.games) return 'No finished games yet';
    return `${plural(st.games, 'game')} · ${plural(st.wins, 'win')} · best move ${plural(st.bestMove, 'tile')}`;
  }
  const key0 = (key) => key[0];
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

  function miniTile(t, small, extra = '') {
    const cls = t.joker ? 'joker' : 'c' + t.color;
    return `<span class="mini ${cls}${small ? ' small' : ''} ${extra}">${t.joker ? '☻' : t.value}</span>`;
  }

  const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
  const ordinal = (n) => ['', '1st', '2nd', '3rd', '4th'][n];
  const medal = (n) => ['', '🥇', '🥈', '🥉', '🎗️'][n];

  function clearHint() {
    hintIds = new Set();
    $('#hintbox').classList.remove('show');
  }

  function showHint() {
    const hint = game.hint();
    const box = $('#hintbox');
    if (hint.type === 'draw') {
      hintIds = new Set();
      const what = game.pool.length ? 'draw a tile' : 'pass';
      const why = game.turn.startMelded ? 'None of your tiles fit on the table' : `You cannot reach ${FIRST_MELD_POINTS} points yet`;
      box.innerHTML = `<div class="title">💡 ${why} — ${what}.</div>`;
    } else {
      hintIds = new Set(hint.played.map((t) => t.id));
      const n = hint.played.length;
      const sets = hint.sets
        .map((tiles) => `<div class="hint-set">${tiles.map((t) => miniTile(t, false, hintIds.has(t.id) ? 'mine' : '')).join('')}</div>`)
        .join('');
      const note = game.placedTiles().length
        ? '<div class="note">Counted from the start of your turn — solving takes back the tiles you have placed.</div>'
        : '';
      box.innerHTML = `<div class="title">💡 You can play ${n} tile${n === 1 ? '' : 's'}. Build ${hint.sets.length === 1 ? 'this set' : 'these sets'}:</div>
        <div class="hint-sets">${sets}</div>${note}
        <div class="hint-actions">
          <button class="btn solve" id="hint-solve">Have Sara solve it</button>
          <button class="btn ghost" id="hint-close">Close</button>
        </div>`;
    }
    if (!$('#hint-close')) {
      box.innerHTML += '<div class="hint-actions"><button class="btn ghost" id="hint-close">Close</button></div>';
    }
    $('#hint-close').onclick = () => box.classList.remove('show');
    if ($('#hint-solve')) {
      $('#hint-solve').onclick = () => {
        if (!humanTurn()) return;
        const res = game.applyHint();
        clearHint();
        if (res.ok) {
          clack(res.count);
          toast(`Sara played ${res.count} tile${res.count === 1 ? '' : 's'} for you — end your turn when you are ready.`);
        }
        render({ stagger: true });
      };
    }
    box.classList.add('show');
    render();
  }

  // ---- layout and rendering ------------------------------------------------

  function viewRackRows() {
    return view === null ? 2 : game.players[view].rack.length / RACK_COLS;
  }

  function layout() {
    const stage = $('#stage').getBoundingClientRect();
    const W = stage.width;
    const H = window.innerHeight;
    const rackRows = viewRackRows();
    const byHeight = ((H - 190 - RACK_LIFT) / (rowsNow() + rackRows)) * 0.76;
    const byBoard = (W - 40) / COLS;
    const byRack = (W - 2 * 166 - 52) / RACK_COLS;
    cw = Math.max(22, Math.min(64, Math.floor(Math.min(byHeight, byBoard, byRack))));
    ch = Math.round(cw / 0.76);
    const root = document.documentElement.style;
    root.setProperty('--cw', cw + 'px');
    root.setProperty('--ch', ch + 'px');
    root.setProperty('--rows', rowsNow());
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
          <div class="avatar-col"><div class="avatar">${face(i)}</div>${p.isAI ? `<span class="lvl" title="${levelName(p.level)}">${LEVEL_DOTS(p.level)}</span>` : ''}</div>
          <div>
            <div class="name-row"><span class="name">${esc(p.name)}</span><span class="trophy" title="Played every tile">🏆</span></div>
            <div class="meta"><span class="count"></span><span class="badge"></span></div>
          </div>
          <div class="thinking"><i></i><i></i><i></i></div>
        </div>`
      )
      .join('');
  }

  // tileById points at the tiles of the current game object
  function indexTiles() {
    tileById.clear();
    const all = game.pool.concat(game.board.filter(Boolean));
    game.players.forEach((p) => all.push(...game.rackTiles(p)));
    all.forEach((t) => tileById.set(t.id, t));
  }

  function buildTiles() {
    layer.innerHTML = '<div id="dropmark"></div>';
    dropmark = $('#dropmark');
    tileEls.clear();
    tileById.clear();
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
      tileById.set(t.id, t);
    }
  }

  function renderPlayers() {
    game.players.forEach((p, i) => {
      const el = $('#panel-' + i);
      el.classList.toggle('active', !game.over && game.turn !== null && i === game.current);
      el.classList.toggle('thinking', i === thinking);
      el.classList.toggle('out', p.place > 0);
      el.querySelector('.count').textContent = game.rackTiles(p).length;
      const badge = el.querySelector('.badge');
      badge.textContent = p.place ? `${medal(p.place)} ${ordinal(p.place).toUpperCase()}` : p.melded ? 'MELDED' : 'NO MELD';
      badge.className = 'badge ' + (p.melded ? 'yes' : 'no');
    });
    $('#pool-count').textContent = game.pool.length;
  }

  function renderSets() {
    boardEl.querySelectorAll('.set-outline').forEach((el) => el.remove());
    layer.querySelectorAll('.set-handle').forEach((el) => el.remove());
    const mine = humanTurn();
    boardEl.classList.toggle('my-turn', mine);
    const changed = scene ? scene.changed : liveChangedSets();
    for (const s of game.findSets(boardNow(), rowsNow())) {
      const el = document.createElement('div');
      let state = s.valid ? 'valid' : s.tiles.length < 3 ? 'pending' : 'invalid';
      if (s.valid && changed.has(s.idx)) state = 'changed';
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

      if (mine && !scene && game.canMoveSet(s.idx)) {
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
    $('#btn-hint').disabled = !mine || isOnline();
    $('#btn-reset').disabled = !mine || status.placed === 0;
    $('#btn-draw').disabled = !mine;
    $('#btn-end').disabled = !mine || !status.canEnd;
    $('#btn-draw').textContent = !game.pool.length ? 'Pass' : status && status.placed ? 'Take back & draw' : 'Draw tile';
    $('#btn-save').disabled = game.over || isOnline();
    document.querySelectorAll('.side').forEach((el) => (el.style.visibility = humans() ? 'visible' : 'hidden'));

    let text = '';
    if (statusOverride !== null) text = statusOverride;
    else if (mine) text = (humans() === 1 ? 'Your turn. ' : `${current().name}'s turn. `) + status.msg;
    $('#status-text').textContent = text;
    if (!mine) $('#assist').classList.remove('show');

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
    if (dealing) {
      game.board.forEach((t) => t && target.set(t.id, tuck(rects.pool, 'pool')));
      game.players.forEach((p) => game.rackTiles(p).forEach((t) => target.set(t.id, tuck(rects.pool, 'pool'))));
    } else if (scene) {
      // tiles that are not part of the replayed board wait at the pool, the
      // ones about to be played wait with their player
      game.board.forEach((t) => t && target.set(t.id, tuck(rects.pool, 'pool')));
      scene.mark.forEach((id) => target.set(id, tuck(rects.panels[scene.player], 'h' + scene.player)));
    }
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
    const badIds = new Set();
    for (const s of game.findSets(boardNow(), rowsNow())) if (!s.valid) s.tiles.forEach((t) => badIds.add(t.id));
    boardNow().forEach((t, i) => {
      if (!t) return;
      const locked = game.turn ? game.isLocked(t) : true;
      target.set(t.id, {
        x: rects.board.left + (i % COLS) * cw + 2,
        y: rects.board.top + Math.floor(i / COLS) * ch + 2,
        key: 'b' + i,
        movable: mine && !scene && (!locked || game.turn.startMelded),
        fresh: !scene && humanNow && !locked,
        last: scene ? scene.mark.has(t.id) : game.lastPlayed.has(t.id),
        bad: badIds.has(t.id),
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
      el.classList.toggle('fresh', !!tg.fresh && !tg.bad);
      el.classList.toggle('bad', !!tg.bad);
      el.classList.toggle('last', !!tg.last && !tg.fresh);
      el.classList.toggle('hint', hintIds.has(id) && key0(tg.key) === 'r');
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
    renderLog();
  }

  // ---- move detail, log and replay -------------------------------------------

  // Sets on the "after" board that did not exist as such on the "before" board.
  function changedSets(before, after) {
    const seen = new Set(game.findSets(before.board.map((id) => (id === null ? null : tileById.get(id))), before.rows).map((s) => s.tiles.map((t) => t.id).join(',')));
    const sets = game.findSets(after.board.map((id) => (id === null ? null : tileById.get(id))), after.rows);
    const changed = new Set();
    sets.forEach((s) => !seen.has(s.tiles.map((t) => t.id).join(',')) && changed.add(s.idx));
    return { sets, changed };
  }

  // The previous move stays outlined in blue until someone touches the table.
  function liveChangedSets() {
    const last = game.history[game.history.length - 1];
    if (!last || last.type !== 'play') return new Set();
    const now = game.board.map((t) => (t ? t.id : null));
    if (now.length !== last.after.board.length || now.some((id, i) => id !== last.after.board[i])) return new Set();
    return changedSets(last.before, last.after).changed;
  }

  function showMoveBox(entry, replay) {
    const box = $('#movebox');
    const p = game.players[entry.player];
    const who = isMe(p.id) ? 'You' : p.name;
    const { sets, changed } = changedSets(entry.before, entry.after);
    const mark = new Set(entry.played);
    const shown = sets.filter((s) => changed.has(s.idx));
    const html = shown
      .map((s) => `<div class="move-set">${s.tiles.map((t) => miniTile(t, true, mark.has(t.id) ? 'mine' : '')).join('')}</div>`)
      .join('');
    const rearranged = shown.reduce((n, s) => n + s.tiles.filter((t) => !mark.has(t.id)).length, 0);
    let title;
    if (entry.type === 'play') title = `${who} played ${entry.count} tile${entry.count === 1 ? '' : 's'}${entry.place ? ` and went out ${ordinal(entry.place)} 🏆` : ''}`;
    else if (entry.type === 'draw') title = `${who} drew a tile`;
    else title = `${who} passed`;
    const sub = replay ? `Replay of move ${entry.n}` : 'Blue = the tiles this move put down';
    const note = rearranged ? `<div class="note">${rearranged} tile${rearranged === 1 ? '' : 's'} already on the table ${rearranged === 1 ? 'was' : 'were'} rearranged to make room.</div>` : '';
    box.innerHTML = `<button class="close" title="Close">✕</button><div class="title">${esc(title)}<small>${sub} · ${entry.left} tile${entry.left === 1 ? '' : 's'} left</small></div>
      ${html ? `<div class="move-sets">${html}</div>` : ''}${note}`;
    box.querySelector('.close').onclick = () => box.classList.remove('show');
    box.classList.add('show');
  }

  function hideMoveBox() {
    $('#movebox').classList.remove('show');
  }

  function renderLog() {
    const list = $('#log-list');
    const entries = game.history;
    if (!entries.length) {
      list.innerHTML = '<div class="empty">Moves will appear here as the game goes on. Click one to replay it.</div>';
      return;
    }
    const activeN = scene ? scene.entry.n : -1;
    if (list._count !== entries.length || list._active !== activeN) {
      list.innerHTML = entries
        .map((h) => {
          const p = game.players[h.player];
          const what =
            h.type === 'play'
              ? `played ${h.count} tile${h.count === 1 ? '' : 's'}${h.place ? ` · out ${ordinal(h.place)} 🏆` : ''}`
              : h.type === 'draw'
                ? 'drew a tile'
                : 'passed';
          return `<div class="log-item ${h.n === activeN ? 'active' : ''}" data-n="${h.n}" style="--pc:${PLAYER_COLORS[h.player]}">
            <span class="n">${h.n}</span><span class="avatar">${face(h.player)}</span>
            <span class="what"><b>${esc(p.name)}</b>${what} <small>· ${h.left} left</small><small class="time">${clock(h.at)}</small></span></div>`;
        })
        .join('');
      if (list._count !== entries.length) list.scrollTop = list.scrollHeight;
      list._count = entries.length;
      list._active = activeN;
    }
    $('#log').classList.toggle('replaying', !!scene);
  }

  $('#log-list').addEventListener('click', (e) => {
    const item = e.target.closest('.log-item');
    if (!item || !game) return;
    const entry = game.history[+item.dataset.n - 1];
    if (entry) replay(entry);
  });

  $('#log-toggle').addEventListener('click', () => {
    const closed = $('#log').classList.toggle('closed');
    $('#log-toggle').textContent = closed ? '›' : '‹';
    setTimeout(renderInstant, 260);
    renderInstant();
  });

  $('#log-live').addEventListener('click', endReplay);

  // Shows the table as it was before the move, then animates the move onto it.
  async function replay(entry) {
    const token = ++replayToken;
    if (drag) return;
    if (!scene) {
      pausedBeforeReplay = paused;
      paused = true;
      $('#btn-pause').textContent = '▶';
      $('#btn-pause').classList.add('on');
    }
    clearHint();
    const frame = (b) => ({ board: b.board.map((id) => (id === null ? null : tileById.get(id))), rows: b.rows });
    scene = { ...frame(entry.before), mark: new Set(entry.played), changed: new Set(), player: entry.player, entry };
    render();
    showMoveBox(entry, true);
    await sleep(1000);
    if (token !== replayToken || !scene) return;
    scene = { ...frame(entry.after), mark: new Set(entry.played), changed: changedSets(entry.before, entry.after).changed, player: entry.player, entry };
    render({ stagger: true });
    if (entry.type === 'play') clack(entry.count);
  }

  function endReplay() {
    if (!scene) return;
    replayToken++;
    scene = null;
    paused = pausedBeforeReplay;
    $('#btn-pause').textContent = paused ? '▶' : '⏸';
    $('#btn-pause').classList.toggle('on', paused);
    hideMoveBox();
    render({ stagger: true });
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
    $('#hintbox').classList.remove('show');
    hideMoveBox();
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
      const twice = lastDown.id === +el.dataset.id && performance.now() - lastDown.t < 450;
      lastDown = { id: +el.dataset.id, t: performance.now() };
      if ((e.shiftKey || twice) && game.canMoveSet(loc.idx)) {
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

  // Draws the eye to what a player still holds once their turn is over.
  function emphasize(playerIdx) {
    const p = game.players[playerIdx];
    const panel = $('#panel-' + playerIdx);
    const count = panel.querySelector('.count');
    count.classList.remove('pop');
    void count.offsetWidth;
    count.classList.add('pop');
    panel.classList.add('emph');
    setTimeout(() => panel.classList.remove('emph'), 2200);
    if (playerIdx !== view) return;
    for (const t of game.rackTiles(p)) {
      const el = tileEls.get(t.id);
      el.classList.remove('remain');
      void el.offsetWidth;
      el.classList.add('remain');
      setTimeout(() => el.classList.remove('remain'), 2300);
    }
  }

  function turnDone(action) {
    turnSound();
    if (action.place) wahoo(0.45);
    if (action.type === 'play' && action.count >= settings.celebrateTiles) scrabalicious(action);
    emphasize(action.player);
  }

  // A turn that put down more than seven tiles deserves a fuss.
  function scrabalicious(action) {
    const p = game.players[action.player];
    cheer(settings.celebrateText, `${p.name} played ${action.count} tiles in one turn`);
  }

  function cheer(word, sub) {
    celebration();
    const el = $('#bigtext');
    el.innerHTML = `<div class="word">${esc(word)}</div><div class="sub">${esc(sub)}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3600);
  }

  // The move-assist setting: a nudge at the start of a human turn.
  function showAssist() {
    const el = $('#assist');
    el.textContent = '';
    el.classList.remove('show');
    if (!humanTurn() || settings.assist === 'off' || isOnline()) return;
    if (settings.assist === 'hint') return showHint();
    const hint = game.hint();
    const rackCount = game.rackTiles(current()).length;
    let text = '';
    if (settings.assist === 'any') text = hint.type === 'play' ? '✅ You have a move' : '🚫 No move — draw';
    else if (settings.assist === 'count') {
      const n = hint.type === 'play' ? hint.played.length : 0;
      text = n ? `✅ You can play ${n} tile${n === 1 ? '' : 's'}` : '🚫 No move — draw';
    } else if (settings.assist === 'out') {
      text = hint.type === 'play' && hint.played.length === rackCount ? '🏆 You can go out this turn!' : '🎲 Not out this turn';
    }
    el.textContent = text;
    el.classList.add('show');
  }

  function leftText(p) {
    const n = game.rackTiles(p).length;
    return n ? ` ${n} tile${n === 1 ? '' : 's'} left.` : '';
  }

  function describe(action) {
    const p = game.players[action.player];
    const who = isMe(p.id) ? 'You' : p.name;
    if (action.type === 'play') {
      const out = action.place ? ` — and went out in ${ordinal(action.place)} place! 🏆` : '.' + leftText(p);
      return `${who} played ${action.count} tile${action.count === 1 ? '' : 's'}${out}`;
    }
    if (action.type === 'draw') return `${who} drew a tile.` + leftText(p);
    return `${who} passed.` + leftText(p);
  }

  async function runTurn() {
    const token = turnToken;
    if (game.over) return showGameOver();
    const p = current();

    if (isOnline() && config.players[game.current].remote) {
      busy = true;
      thinking = game.current;
      if (humans() > 1) view = null; // several people here: nobody's rack shows while others play
      statusOverride = `Waiting for ${p.name} to play…`;
      render({ stagger: true });
      waitTick();
      return; // the next state from the database moves things on
    }
    stopWaiting();

    if (p.isAI) {
      hideMoveBox();
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
      render({ stagger: true });
      turnDone(action);
      if (action.type === 'play') showMoveBox(game.history[game.history.length - 1], false);
      await wait(action.place ? 3200 : action.type === 'play' ? 2600 : 800);
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
    showAssist();
  }

  async function afterHumanAction() {
    const token = turnToken;
    busy = true;
    clearHint();
    hideMoveBox();
    statusOverride = describe(game.lastAction);
    render();
    turnDone(game.lastAction);
    await sleep(game.lastAction.place ? 2200 : game.lastAction.type === 'draw' ? 1100 : 700);
    if (token !== turnToken) return;
    if (!game.over) game.nextTurn();
    if (isOnline()) await publishTurn();
    if (token !== turnToken) return;
    runTurn();
  }

  $('#btn-end').addEventListener('click', () => {
    if (!humanTurn()) return;
    const res = game.endTurn();
    if (!res.ok) return toast(res.reason);
    afterHumanAction();
  });

  $('#btn-draw').addEventListener('click', () => {
    if (!humanTurn()) return;
    game.drawAndPass();
    afterHumanAction();
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!humanTurn()) return;
    game.resetTurn();
    clearHint();
    render({ stagger: true });
  });

  $('#btn-hint').addEventListener('click', () => {
    if (humanTurn()) showHint();
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      return saveGame();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      return loadGame();
    }
    if (e.key === 'Enter' && humanTurn() && game.turnStatus().canEnd) $('#btn-end').click();
  });

  // ---- saving and loading ---------------------------------------------------

  const SAVE_EXT = '.rummikub';

  // In the app these go through native dialogs, in a plain browser through
  // a download and a file picker.
  async function writeFile(name, text) {
    if (window.rkFiles) return window.rkFiles.save(name, text);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return name;
  }

  function readFile() {
    if (window.rkFiles) return window.rkFiles.load();
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = SAVE_EXT + ',application/json';
      input.onchange = async () => {
        const file = input.files[0];
        resolve(file ? { name: file.name, text: await file.text() } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function saveGame() {
    if (!game || !game.turn || game.over || drag) return toast('There is no game in progress to save.');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const text = JSON.stringify(
      {
        app: 'rummi-tummi',
        savedAt: new Date().toISOString(),
        faces: config.players.map((p) => p.face),
        photos: config.players.map((p) => p.photo || null),
        game,
      },
      null,
      1
    );
    try {
      const name = await writeFile(`Rummi Tummi ${stamp}${SAVE_EXT}`, text);
      if (name) toast(`Game saved to “${name}”.`);
    } catch (err) {
      toast('Could not save the game: ' + err.message);
    }
  }

  async function loadGame() {
    if (drag) return;
    let file;
    try {
      file = await readFile();
    } catch (err) {
      return toast('Could not open the file: ' + err.message);
    }
    if (!file) return;
    let loaded;
    let faces;
    try {
      let data;
      try {
        data = JSON.parse(file.text);
      } catch (err) {
        throw new Error('This file is not a valid saved game (unreadable).');
      }
      if (!data || !['rummi-tummi', 'rummi-tumi', 'lyndas-rummikub', 'tinas-rummikub'].includes(data.app)) throw new Error('This file is not a saved Rummi Tummi game.');
      loaded = Game.fromJSON(data.game);
      faces = Array.isArray(data.faces) ? data.faces : [];
      faces.photos = Array.isArray(data.photos) ? data.photos : [];
    } catch (err) {
      return toast(err.message);
    }
    resumeGame(loaded, faces, file.name);
  }

  function resumeGame(loaded, faces, name) {
    turnToken++;
    replayToken++;
    scene = null;
    clearHint();
    hideMoveBox();
    hideOverlay();
    paused = false;
    $('#btn-pause').textContent = '⏸';
    $('#btn-pause').classList.remove('on');
    game = loaded;
    let h = 0;
    let a = 0;
    config = {
      players: game.players.map((p, i) => ({
        name: p.name,
        isAI: p.isAI,
        level: p.level,
        face: typeof faces[i] === 'string' && faces[i].length <= 8 ? faces[i] : p.isAI ? AI_FACES[a++] : HUMAN_FACES[h++],
        // a registered player shows their current picture, otherwise the one saved with the game
        photo: (P.findById(db, p.profileId) || {}).photo || (P.isPhoto((faces.photos || [])[i]) ? faces.photos[i] : null),
        profileId: p.profileId,
      })),
    };
    view = null;
    if (humans() === 0) view = game.current;
    else if (humans() === 1) view = game.players.findIndex((p) => !p.isAI);
    busy = true;
    thinking = -1;
    statusOverride = '';
    buildPlayers();
    buildTiles();
    renderInstant();
    toast(`Loaded “${name}”.`);
    // a move that was already made only needs the turn to be passed on
    if (!game.over && game.acted) game.nextTurn();
    runTurn();
  }

  $('#btn-save').addEventListener('click', saveGame);
  $('#btn-load').addEventListener('click', loadGame);

  // ---- online ---------------------------------------------------------------

  let online = { ready: false, error: null, connected: false, friends: [], stopFriends: null, stopConn: null };

  C.onError((err) => {
    online.error = err.message;
    toast('Online: ' + (err.code === 'PERMISSION_DENIED' ? 'the database refused that change.' : err.message));
  });

  // Signs in, publishes this computer's online players and starts watching
  // their friends. Safe to call again whenever the players change.
  async function goOnline() {
    const mine = P.cloudProfiles(db);
    if (!C.configured() || !mine.length) return;
    try {
      await C.init();
      online.ready = true;
      online.error = null;
      for (const p of mine) await C.publishPlayer(p);
      await C.setPresence(mine.map((p) => p.id), game && config && config.online ? game.id : null);
      if (online.stopFriends) online.stopFriends();
      online.stopFriends = C.watchFriends(
        mine.map((p) => p.id),
        (friends) => {
          online.friends = friends;
          reflectOnline();
        }
      );
      watchInvitations();
      if (!online.stopConn) {
        online.stopConn = C.watchConnection((up) => {
          online.connected = up;
          reflectOnline();
        });
      }
    } catch (err) {
      online.error = err.message;
    }
    reflectOnline();
  }

  function reflectOnline() {
    const summary = L.friendsSummary(online.friends);
    const badge = $('#online-count');
    badge.textContent = online.ready && summary.online ? summary.online : '';
    $('#btn-online').classList.toggle('on', online.ready && online.connected);
    $('#btn-online').title = online.ready
      ? L.summaryText(summary) + (online.connected ? '' : ' — reconnecting…')
      : 'Friends online and invitations';
    if (overlay.querySelector('.online-home')) showOnlineHome();
    const line = $('#start-friends');
    if (line) line.textContent = online.ready ? L.summaryText(summary) : 'Play friends on their own computers';
  }

  function showOnlineHome() {
    const mine = P.cloudProfiles(db);
    const summary = L.friendsSummary(online.friends);
    const pill = (state) => `<span class="pill ${state}">${state === 'playing' ? 'Playing now' : state === 'online' ? 'Online' : 'Offline'}</span>`;
    let body;
    if (!C.configured()) {
      body = `<p class="hint">Online play is not set up yet. Follow <b>docs/online.md</b> once, then paste the connection details into <b>src/config.js</b>.</p>`;
    } else if (!mine.length) {
      body = `<p class="hint">Nobody on this computer plays online yet. Register a player and tick <b>Plays online from this computer</b>.</p>`;
    } else {
      const you = mine
        .map((p) => `<div class="online-row"><div class="avatar">${avatarHtml(p)}</div><div class="name">${esc(p.name)}</div>
            <span class="pill ${online.ready && online.connected ? 'online' : 'offline'}">${online.ready ? (online.connected ? 'Online' : 'Reconnecting…') : online.error ? 'Not connected' : 'Connecting…'}</span></div>`)
        .join('');
      const friends = summary.list
        .map((f) => `<div class="online-row"><div class="avatar">${avatarHtml(f)}</div><div class="name">${esc(f.name)}</div>${pill(f.state)}
            ${f.state === 'online' ? `<button class="tool" data-invite-friend="${f.pid}">Invite to join my game</button>` : ''}</div>`)
        .join('');
      body = `<div class="online-status">${esc(L.summaryText(summary))}</div>
        <div class="actions"><button class="btn big primary" id="online-host" ${online.ready ? '' : 'disabled'}>🎲 Start an online game</button></div>
        <h3>Your online players</h3><div class="online-list">${you}</div>
        <h3>Friends</h3><div class="online-list">${friends || '<p class="hint">Friends appear here after you have played a game online together.</p>'}</div>
        ${online.error ? `<p class="hint">${esc(online.error)}</p>` : ''}`;
    }
    const wasPaused = paused;
    if (game && !game.over) paused = true;
    showCard(
      `<div class="online-home"><h2>🌐 Online</h2>${body}
       <div class="actions"><button class="btn big primary" id="online-close">Close</button></div></div>`,
      true
    );
    $('#online-close').onclick = () => closeCard(wasPaused);
    if ($('#online-host')) $('#online-host').onclick = () => hostLobby();
    overlay.querySelectorAll('[data-invite-friend]').forEach((b) => (b.onclick = () => hostLobby(b.dataset.inviteFriend)));
  }

  // ---- online play: invitations, lobby and game start ------------------------------

  const isOnline = () => !!(config && config.online);
  const myPerson = (profile) => ({ pid: profile.id, device: C.deviceId(), name: profile.name, face: profile.face });
  let lobby = null; // the lobby this computer is in, as host or guest
  let inbox = [];
  let shownInvite = null; // token of the invitation popup on screen
  let dealing = false; // tiles wait at the pool until the opening draw is over

  function stopLobby() {
    if (!lobby) return;
    clearInterval(lobby.tick);
    for (const off of lobby.stops) off();
    lobby.invites.forEach((inv) => inv.stop && inv.stop());
    lobby = null;
  }

  // ---- host side ----

  // Opens a lobby with this computer's online players seated; invitePid, if
  // given, is a friend to invite straight away.
  async function hostLobby(invitePid, { show = true } = {}) {
    const mine = P.cloudProfiles(db);
    if (!online.ready || !mine.length) return toast('Go online first — register a player who plays online from this computer.');
    if (lobby && lobby.host) {
      if (invitePid) inviteFriend(invitePid);
      return show ? showLobby() : undefined;
    }
    stopLobby();
    try {
      const gid = await C.createGame(myPerson(mine[0]));
      lobby = { gid, host: true, hostPerson: myPerson(mine[0]), seats: {}, invites: new Map(), meta: null, createdAt: C.serverNow(), stops: [], tick: 0 };
      for (let i = 0; i < Math.min(mine.length, 3); i++) {
        const seat = { ...myPerson(mine[i]), token: null, status: 'ready', at: 0 };
        await C.setSeat(gid, i, seat);
        lobby.seats[String(i)] = seat; // known before the database echoes it back
      }
      lobby.stops.push(C.watchSeats(gid, (seats) => lobby && lobby.gid === gid && ((lobby.seats = seats), refreshLobby())));
      lobby.stops.push(C.watchMeta(gid, (meta) => lobby && lobby.gid === gid && ((lobby.meta = meta), refreshLobby())));
      lobby.tick = setInterval(refreshLobby, 1000);
      if (invitePid) await inviteFriend(invitePid);
      if (show) showLobby();
    } catch (err) {
      toast('Could not open a lobby: ' + err.message);
    }
  }

  async function inviteFriend(pid) {
    const f = online.friends.find((x) => x.pid === pid);
    if (!lobby || !lobby.host || !f) return;
    const seat = L.freeSeat(lobby.seats, [...lobby.invites.values()].map((i) => i.invite));
    if (!seat) return toast('The table is full — four players at most.');
    try {
      const token = await C.createInvite({ gid: lobby.gid, seat, from: lobby.hostPerson, toPid: pid });
      trackInvite(token, { toPid: pid, name: f.name, face: f.face, photo: f.photo, seat });
    } catch (err) {
      toast('Could not send the invitation: ' + err.message);
    }
  }

  function trackInvite(token, info) {
    const entry = { token, ...info, invite: null, stop: null };
    entry.stop = C.watchInvite(token, (inv) => {
      entry.invite = inv;
      refreshLobby();
    });
    lobby.invites.set(token, entry);
    refreshLobby();
  }

  const openExternal = (url) => (window.rkCloud ? window.rkCloud.openExternal(url) : Promise.resolve(window.open(url))).catch((err) => toast(err.message));
  const onMac = /Mac/.test(navigator.platform);

  // One link for someone who is not (yet) a friend. Resolves to the link and
  // the message that carries it, or null if no seat is free.
  async function createMessageInvite() {
    if (!lobby || !lobby.host) return null;
    const seat = L.freeSeat(lobby.seats, [...lobby.invites.values()].map((i) => i.invite));
    if (!seat) {
      toast('The table is full — four players at most.');
      return null;
    }
    let token;
    try {
      token = await C.createInvite({ gid: lobby.gid, seat, from: lobby.hostPerson, toPid: null });
    } catch (err) {
      toast('Could not create the invitation: ' + err.message);
      return null;
    }
    trackInvite(token, { toPid: null, name: 'Invited by message', face: '✉️', photo: null, seat });
    const link = L.buildJoinLink(RK.CLOUD.scheme, token);
    return { token, link, text: L.inviteMessage({ hostName: lobby.hostPerson.name, link, releasesUrl: RK.CLOUD.releasesUrl }) };
  }

  const MAIL_SUBJECT = "Join my game of Lynda's Rummi Tummi";
  function sendInvite(kind, handle, inv) {
    if (kind === 'sms') return openExternal(L.smsUrl(handle, inv.text));
    if (kind === 'mail') return openExternal(L.mailtoUrl(handle, inv.text, MAIL_SUBJECT));
    return navigator.clipboard
      .writeText(inv.link)
      .then(() => toast('Invitation link copied.'))
      .catch(() => toast('Could not copy: ' + inv.link));
  }

  // The invitation dialog inside the lobby.
  async function inviteByMessage() {
    const inv = await createMessageInvite();
    if (!inv) return;
    const known = P.invitable(db).map((p) => `<option value="${esc(p.handle)}">${esc(p.name)}</option>`).join('');
    showCard(
      `<h2>Invite a player</h2>
       <p>The message below is filled in for you — you only press send.</p>
       <label class="invite-to">Send to (phone number or email, optional)
         <input id="inv-to" list="known-handles" placeholder="+1 555 010 2030 or name@example.com"><datalist id="known-handles">${known}</datalist></label>
       <textarea id="inv-text" readonly>${esc(inv.text)}</textarea>
       <div class="actions">
         ${onMac ? '<button class="btn big" id="inv-sms">💬 iMessage</button>' : ''}
         <button class="btn big" id="inv-mail">✉️ Email</button>
         <button class="btn big" id="inv-copy">📋 Copy link</button>
       </div>
       <button class="link" id="inv-back">Back to the lobby</button>`,
      false
    );
    const to = () => P.cleanHandle($('#inv-to').value) || '';
    if ($('#inv-sms')) $('#inv-sms').onclick = () => sendInvite('sms', to(), inv);
    $('#inv-mail').onclick = () => sendInvite('mail', to(), inv);
    $('#inv-copy').onclick = () => sendInvite('copy', '', inv);
    $('#inv-back').onclick = showLobby;
  }

  // Straight from the start screen: open a lobby, make an invitation and hand
  // it to Messages or Mail, then show the lobby so its progress can be watched.
  async function quickInvite(kind, typed) {
    const handle = P.cleanHandle(typed);
    if (handle === null) return toast('That does not look like a phone number or an email address.');
    if (!(await ensureOnlinePlayer())) return;
    await hostLobby(null, { show: false });
    if (!lobby || !lobby.host) return;
    const inv = await createMessageInvite();
    if (inv) await sendInvite(kind, handle, inv);
    showLobby();
  }

  // Online play needs someone on this computer who plays online. Resolves to
  // true once there is one and the connection is up.
  async function ensureOnlinePlayer() {
    if (!C.configured()) {
      toast('Online play is not set up on this computer yet.');
      return false;
    }
    if (!P.cloudProfiles(db).length) {
      const chosen = await new Promise((resolve) => {
        const rows = db.profiles.map((p) => `<button class="btn big" data-who="${p.id}">${avatarHtml(p)} ${esc(p.name)}</button>`).join('');
        showCard(
          `<h2>Who is playing online?</h2>
           <p>Friends will see this player when they are online, and can invite them.</p>
           <div class="join-choices">${rows}<button class="btn big primary" id="who-new">✨ New player…</button></div>
           <button class="link" id="who-cancel">Not now</button>`,
          false
        );
        overlay.querySelectorAll('[data-who]').forEach((b) => {
          b.onclick = () => {
            const p = P.findById(db, b.dataset.who);
            p.cloud = true;
            saveDb();
            resolve(true);
          };
        });
        $('#who-new').onclick = () => showProfile({ name: '', face: FACE_CHOICES[db.profiles.length % FACE_CHOICES.length], cloud: true }, (saved) => resolve(!!(saved && saved.cloud)));
        $('#who-cancel').onclick = () => resolve(false);
      });
      if (!chosen) {
        showStart();
        return false;
      }
    }
    await goOnline();
    if (!online.ready) {
      toast('Could not connect: ' + (online.error || 'no connection'));
      showStart();
    }
    return online.ready;
  }

  async function removeInvite(token) {
    const entry = lobby && lobby.invites.get(token);
    if (!entry) return;
    entry.stop && entry.stop();
    lobby.invites.delete(token);
    await C.revokeInvite(token, entry.toPid).catch(() => {});
    const seat = lobby.seats[entry.seat];
    if (seat && seat.token === token) await C.removeSeat(lobby.gid, entry.seat).catch(() => {});
    refreshLobby();
  }

  async function cancelLobby() {
    if (!lobby) return;
    const l = lobby;
    stopLobby();
    if (l.host) {
      for (const [token, entry] of l.invites) await C.revokeInvite(token, entry.toPid).catch(() => {});
      await C.deleteGame(l.gid);
    } else if (l.seat !== undefined) {
      await C.removeSeat(l.gid, l.seat).catch(() => {});
    }
    showStart();
  }

  const refreshLobby = () => {
    if (overlay.querySelector('.lobby')) showLobby();
  };

  function showLobby() {
    if (!lobby) return showStart();
    const now = C.serverNow();
    const ttl = RK.CLOUD.inviteTtlMs;
    const uid = C.deviceId();
    const seats = lobby.seats;
    const seatRows = Object.keys(seats)
      .sort()
      .filter((n) => seats[n])
      .map((n) => {
        const s = seats[n];
        const local = s.device === uid;
        const inv = s.token && lobby.invites.get(s.token);
        return `<div class="online-row"><div class="avatar">${avatarHtml(inv && inv.photo ? { photo: inv.photo, face: s.face } : local ? P.findById(db, s.pid) || s : s)}</div>
          <div class="name">${esc(s.name)}${local ? ' <small>(this computer)</small>' : ''}</div>
          <span class="pill ${s.status === 'ready' ? 'online' : 'playing'}">${s.status === 'ready' ? 'Ready' : 'Joining game'}</span>
          ${lobby.host && !(local && n === '0') ? `<button class="tool" data-unseat="${n}" title="Remove from the table">✕</button>` : ''}</div>`;
      })
      .join('');
    const inviteRows = [...lobby.invites.values()]
      .filter((e) => !(lobby.seats[e.seat] && lobby.seats[e.seat].token === e.token && lobby.seats[e.seat].status === 'ready'))
      .map((e) => {
        // until the database echoes the invitation back it is simply "sent"
        const status = e.invite ? L.inviteStatus(e.invite, lobby.seats[e.seat] && lobby.seats[e.seat].token === e.token ? lobby.seats[e.seat] : null, now, ttl) : 'sent';
        const since = e.invite ? L.fmtElapsed(now - e.invite.createdAt) : '0:00';
        let extra = '';
        if (status === 'later') {
          const left = L.laterUntil(e.invite) - now;
          extra = `<small>ready in ${L.fmtElapsed(left)} — start without them, or wait</small>`;
        }
        const cls = { ready: 'online', declined: 'offline', expired: 'offline', removed: 'offline' }[status] || 'playing';
        return `<div class="online-row"><div class="avatar">${avatarHtml({ photo: e.photo, face: e.face })}</div>
          <div class="name">${esc(e.name)}${extra}</div>
          <span class="pill ${cls}">${L.statusText(status)}</span><span class="wait">${since}</span>
          <button class="tool" data-uninvite="${e.token}" title="Withdraw the invitation">✕</button></div>`;
      })
      .join('');
    const friends = lobby.host
      ? L.friendsSummary(online.friends)
          .list.filter((f) => f.state === 'online' && ![...lobby.invites.values()].some((e) => e.toPid === f.pid) && !Object.values(seats).some((s) => s && s.pid === f.pid))
          .map((f) => `<button class="tool" data-invite="${f.pid}">${esc(f.name)}</button>`)
          .join(' ')
      : '';
    const ready = L.canStart(seats);
    const waiting = L.fmtElapsed(now - (lobby.meta ? lobby.meta.createdAt : lobby.createdAt));
    showCard(
      `<div class="lobby"><h2>🎲 ${lobby.host ? 'Your online game' : `${esc(lobby.hostName || 'The host')}'s game`}</h2>
       <div class="online-status">Waiting ${waiting}</div>
       <h3>At the table</h3><div class="online-list">${seatRows || '<p class="hint">Nobody yet</p>'}</div>
       ${inviteRows ? `<h3>Invited</h3><div class="online-list">${inviteRows}</div>` : ''}
       ${
         lobby.host
           ? `<h3>Invite</h3><div class="invite-bar">${friends ? `<span>Friends online:</span> ${friends}` : '<span class="hint">No friends online to invite right now.</span>'}
              <button class="tool" id="inv-msg">✉️ Invite by iMessage or email…</button></div>`
           : '<p class="hint">The game starts when the host is ready.</p>'
       }
       <div class="actions">
         <button class="btn big" id="lobby-cancel">${lobby.host ? 'Cancel game' : 'Leave'}</button>
         ${lobby.host ? `<button class="btn big primary" id="lobby-start" ${ready ? '' : 'disabled'}>Start game</button>` : ''}
       </div></div>`,
      false
    );
    $('#lobby-cancel').onclick = cancelLobby;
    if ($('#lobby-start')) $('#lobby-start').onclick = startOnlineGame;
    if ($('#inv-msg')) $('#inv-msg').onclick = inviteByMessage;
    overlay.querySelectorAll('[data-invite]').forEach((b) => (b.onclick = () => inviteFriend(b.dataset.invite)));
    overlay.querySelectorAll('[data-uninvite]').forEach((b) => (b.onclick = () => removeInvite(b.dataset.uninvite)));
    overlay.querySelectorAll('[data-unseat]').forEach((b) => (b.onclick = () => C.removeSeat(lobby.gid, b.dataset.unseat).catch((err) => toast(err.message))));
  }

  // The host deals and tells everyone; every computer then plays the opening.
  async function startOnlineGame() {
    if (!lobby || !lobby.host || !L.canStart(lobby.seats)) return;
    const seats = Object.keys(lobby.seats)
      .sort()
      .map((n) => lobby.seats[n])
      .filter(Boolean);
    const gid = lobby.gid;
    const g = new Game({ id: gid, players: seats.map((s) => ({ name: s.name, isAI: false, profileId: s.pid })) });
    const draws = g.pickFirstPlayer();
    g.deal();
    g.beginTurn();
    try {
      await C.startGame(gid, {
        players: seats,
        devices: [...new Set(seats.map((s) => s.device))],
        start: { draws: draws.map((t) => t.id), current: g.current },
        stateJson: JSON.stringify(g),
        current: g.current,
      });
    } catch (err) {
      return toast('Could not start the game: ' + err.message);
    }
    const meta = { host: lobby.hostPerson.pid, hostDevice: C.deviceId(), players: seats, start: { draws: draws.map((t) => t.id), current: g.current } };
    for (const token of lobby.invites.keys()) C.deleteInvite(token); // they have done their job
    stopLobby();
    beginOnlineGame(meta, g);
  }

  // ---- guest side ----

  async function guestLobby(gid, seat, hostName) {
    stopLobby();
    lobby = { gid, host: false, seat, hostName, seats: {}, invites: new Map(), meta: null, createdAt: C.serverNow(), stops: [], tick: 0 };
    lobby.stops.push(C.watchSeats(gid, (seats) => lobby && lobby.gid === gid && ((lobby.seats = seats), refreshLobby())));
    lobby.stops.push(
      C.watchMeta(gid, (meta) => {
        if (!lobby || lobby.gid !== gid) return;
        lobby.meta = meta;
        if (meta && meta.phase === 'playing' && meta.start) {
          if (lobby.joining) return;
          lobby.joining = true;
          joinStartedGame(gid, meta);
        }
        else if (!meta) {
          stopLobby();
          toast('The host cancelled the game.');
          showStart();
        } else refreshLobby();
      })
    );
    lobby.tick = setInterval(refreshLobby, 1000);
    showLobby();
  }

  function joinStartedGame(gid, meta) {
    const off = C.watchState(gid, (state) => {
      if (!state) return;
      off();
      stopLobby();
      let g;
      try {
        g = Game.fromJSON(JSON.parse(state.json));
      } catch (err) {
        return toast('The game could not be loaded: ' + err.message);
      }
      beginOnlineGame(meta, g);
    });
  }

  // Puts this computer into an online game: who is local, who is remote, the
  // tiles, presence and the watchers. Returns the turn token it set.
  function enterOnlineGame(meta, g, appliedRev) {
    const token = ++turnToken;
    replayToken++;
    scene = null;
    clearHint();
    hideMoveBox();
    $('#log-list')._count = -1;
    const uid = C.deviceId();
    config = {
      online: true,
      gid: g.id,
      hostPid: meta.host,
      players: meta.players.map((s) => {
        const local = s.device === uid;
        const prof = local ? P.findById(db, s.pid) : null;
        return { name: s.name, isAI: false, face: s.face, photo: prof ? prof.photo : null, profileId: s.pid, device: s.device, remote: !local };
      }),
    };
    game = g;
    view = null;
    busy = true;
    thinking = -1;
    statusOverride = '';
    buildPlayers();
    buildTiles();
    // everyone at the table becomes friends
    const mine = config.players.filter((p) => !p.remote);
    for (const me of mine) for (const other of config.players) if (other.remote) C.addFriend(me.profileId, other.profileId, { name: other.name, face: other.face }).catch(() => {});
    C.setPresence(P.cloudProfiles(db).map((p) => p.id), g.id).catch(() => {});
    settings.currentGame = g.id;
    if (meta.hostDevice === uid && !settings.hostedGames.includes(g.id)) settings.hostedGames = settings.hostedGames.concat(g.id).slice(-20);
    saveSettings();
    watchOnlineGame(g.id, appliedRev);
    for (const p of config.players) {
      if (!p.remote) continue;
      C.readPlayer(p.profileId).then((rec) => {
        if (rec && rec.photo && token === turnToken) {
          p.photo = rec.photo;
          buildPlayers();
          render();
        }
      });
    }
    return token;
  }

  // Both sides: the game as dealt by the host, the opening draw, then play.
  async function beginOnlineGame(meta, g) {
    const token = enterOnlineGame(meta, g, 0);
    dealing = true;
    renderInstant();
    dealing = false;
    const draws = meta.start.draws.map((id) => tileById.get(id)).filter(Boolean);
    if (draws.length === game.players.length) await showFirstPick(draws, token);
    if (token !== turnToken) return;
    hideOverlay();
    if (humans() === 1) view = config.players.findIndex((p) => !p.remote);
    statusOverride = 'Dealing 14 tiles to every player…';
    clack(6);
    render({ stagger: true });
    await sleep(1500);
    if (token !== turnToken) return;
    runTurn();
  }

  // ---- playing across computers ----

  const sync = { rev: 0, stopState: null, stopPresence: null, presence: new Map(), tick: 0, waitingSince: 0 };

  function watchOnlineGame(gid, appliedRev = 0) {
    stopOnlineGame(false);
    sync.rev = appliedRev;
    sync.stopState = C.watchState(gid, (state) => {
      if (!state || !isOnline() || !game || game.id !== gid) return;
      if (!SY.acceptRev(sync.rev, state.rev)) return;
      sync.rev = state.rev;
      if (state.by === C.deviceId()) return; // our own publish coming back
      applyRemote(state);
    });
    const remote = config.players.filter((p) => p.remote).map((p) => p.profileId);
    sync.stopPresence = C.watchPresenceOf(remote, (map) => {
      sync.presence = map;
      if (game && !game.over && config.players[game.current].remote) waitTick();
    });
  }

  // leaving = true when this computer is done with the game for good
  function stopOnlineGame(leaving = true) {
    stopWaiting();
    if (sync.stopState) sync.stopState();
    if (sync.stopPresence) sync.stopPresence();
    sync.stopState = sync.stopPresence = null;
    if (!leaving) return;
    C.setPresence(P.cloudProfiles(db).map((p) => p.id), null).catch(() => {});
    if (settings.currentGame) {
      settings.currentGame = null;
      saveSettings();
    }
  }

  // After a turn finished on this computer: send the game to everyone else.
  async function publishTurn(extra = {}) {
    const rev = sync.rev + 1;
    try {
      await C.publishState(game.id, SY.packState(game, rev, extra));
      sync.rev = rev;
    } catch (err) {
      // most likely the table moved on without us (we were skipped): take the
      // latest game instead of insisting on ours
      toast('Your move could not be sent — catching up with the table.');
      const latest = await C.readState(game.id).catch(() => null);
      if (latest && SY.acceptRev(sync.rev, latest.rev)) {
        sync.rev = latest.rev;
        applyRemote(latest);
      }
    }
  }

  // A turn made elsewhere: swap in the new game, keep our own rack layouts,
  // animate the difference, then carry on.
  async function applyRemote(state) {
    let next;
    try {
      next = SY.unpackState(state);
    } catch (err) {
      return toast('A move from another computer could not be read: ' + err.message);
    }
    const token = ++turnToken;
    for (let i = 0; i < next.players.length; i++) {
      if (!config.players[i].remote) next.players[i].rack = SY.mergeRack(game.players[i].rack, next.players[i].rack);
    }
    game = next;
    indexTiles();
    clearHint();
    stopWaiting();
    const action = SY.lastActionOf(game);
    thinking = -1;
    busy = true;
    if (action) {
      statusOverride = state.skipped ? `${game.players[action.player].name}'s turn was skipped — a tile was drawn for them.` : describe(action);
    }
    render({ stagger: true });
    if (action) {
      turnDone(action);
      if (action.type === 'play') showMoveBox(game.history[game.history.length - 1], false);
    }
    await sleep(action && action.place ? 3200 : action && action.type === 'play' ? 2400 : 900);
    if (token !== turnToken) return;
    runTurn();
  }

  // While a remote player is up: show how long they have been away and, once
  // they have been offline long enough, let the right computer skip them.
  function waitTick() {
    if (!isOnline() || !game || game.over || !config.players[game.current].remote) return stopWaiting();
    const p = config.players[game.current];
    const presence = sync.presence.get(p.profileId);
    const offline = presence && !presence.online;
    if (!offline) sync.waitingSince = 0;
    else if (!sync.waitingSince) sync.waitingSince = Math.max(presence.at, C.serverNow() - 1000);
    const away = offline ? C.serverNow() - sync.waitingSince : 0;
    statusOverride = offline ? `Waiting for ${p.name} — offline ${L.fmtElapsed(away)}` : `Waiting for ${p.name} to play…`;
    $('#status-text').textContent = statusOverride;
    // the host skips; if the host is away too, the first online seat does
    const online = (q) => !q.remote || (sync.presence.get(q.profileId) || {}).online === true;
    const host = config.players.find((q) => q.profileId === config.hostPid);
    const chosen = host && host !== p && online(host) ? host : config.players.find((q) => q !== p && online(q));
    const mayShow = offline && away >= RK.CLOUD.skipAfterMs && chosen && !chosen.remote;
    $('#btn-skip').hidden = !mayShow;
    if (mayShow) $('#btn-skip').textContent = `⏭ Skip ${p.name}'s turn`;
    if (!sync.tick) sync.tick = setInterval(waitTick, 1000);
  }

  function stopWaiting() {
    clearInterval(sync.tick);
    sync.tick = 0;
    sync.waitingSince = 0;
    $('#btn-skip').hidden = true;
  }

  async function skipTurn() {
    if (!isOnline() || !game || game.over || !config.players[game.current].remote) return;
    const absent = game.players[game.current];
    game.drawAndPass(); // on their behalf: their pending placements are undone, one tile drawn
    game.nextTurn();
    stopWaiting();
    statusOverride = `${absent.name}'s turn was skipped — a tile was drawn for them.`;
    render({ stagger: true });
    await publishTurn({ skipped: true });
    runTurn();
  }
  $('#btn-skip').addEventListener('click', skipTurn);

  // After a restart: if this computer was in an online game that is still
  // going, offer to step back in where the table is now.
  async function offerRejoin() {
    const gid = settings.currentGame;
    if (!gid || !online.ready || game) return;
    const forget = () => {
      settings.currentGame = null;
      saveSettings();
    };
    const meta = await C.readMeta(gid);
    if (!meta || meta.phase !== 'playing' || !meta.devices.includes(C.deviceId())) return forget();
    const state = await C.readState(gid).catch(() => null);
    if (!state) return forget();
    let g;
    try {
      g = SY.unpackState(state);
    } catch (err) {
      return forget();
    }
    if (g.over) return forget();
    const names = meta.players.map((p) => esc(p.name)).join(', ');
    showCard(
      `<h2>Your online game is still going</h2>
       <p>${names} — ${g.history.length} turn${g.history.length === 1 ? '' : 's'} played so far.</p>
       <div class="actions">
         <button class="btn big" id="rejoin-no">Leave it</button>
         <button class="btn big primary" id="rejoin-yes">Rejoin</button>
       </div>`,
      false
    );
    $('#rejoin-no').onclick = () => {
      forget();
      showStart();
    };
    $('#rejoin-yes').onclick = () => {
      hideOverlay();
      enterOnlineGame(meta, g, state.rev);
      if (humans() === 1) view = config.players.findIndex((p) => !p.remote);
      renderInstant();
      toast('Back in the game.');
      runTurn();
    };
  }

  // Games this computer hosted are removed from the database once they are
  // over, or when they have been left lying around for a day.
  async function tidyHostedGames() {
    if (!online.ready) return;
    const keep = [];
    for (const gid of settings.hostedGames) {
      if (gid === settings.currentGame) {
        keep.push(gid);
        continue;
      }
      const meta = await C.readMeta(gid);
      if (meta && meta.phase === 'playing' && C.serverNow() - meta.createdAt < RK.CLOUD.inviteTtlMs) keep.push(gid);
      else if (meta) await C.deleteGame(gid);
    }
    if (keep.length !== settings.hostedGames.length) {
      settings.hostedGames = keep;
      saveSettings();
    }
  }

  // ---- invitations arriving here ----

  function watchInvitations() {
    const mine = P.cloudProfiles(db).map((p) => p.id);
    if (online.stopInbox) online.stopInbox();
    online.stopInbox = C.watchInbox(mine, (items) => {
      inbox = items;
      if (shownInvite && !items.some((i) => i.token === shownInvite)) {
        // withdrawn by the host while the popup was up
        shownInvite = null;
        if (overlay.querySelector('.invite-popup')) {
          toast('That invitation was withdrawn.');
          closeCard(false);
        }
      }
      if (!shownInvite && items.length && !overlay.querySelector('.invite-popup') && !(lobby && !lobby.host)) showInvitePopup(items[0]);
    });
  }

  function showInvitePopup(item) {
    shownInvite = item.token;
    const me = P.findById(db, item.pid);
    const wasPaused = paused;
    if (game && !game.over) paused = true;
    const later = L.LATER_MINUTES.map((m) => `<button class="tool" data-later="${m}">${m} min</button>`).join('');
    showCard(
      `<div class="invite-popup"><div class="logo"><span class="mini c1" style="font-size:30px">${avatarHtml(item.from)}</span></div>
       <h2>${esc(item.from.name)} invites ${esc(me ? me.name : 'you')} to a game</h2>
       <p>Lynda's Rummi Tummi, online, right now.</p>
       <div class="actions">
         <button class="btn big" id="inv-decline">Decline</button>
         <button class="btn big primary" id="inv-accept">Accept</button>
       </div>
       <p class="later-line">Ready in a bit — start without me: ${later}</p></div>`,
      true
    );
    const done = () => {
      shownInvite = null;
      C.removeInbox(item.pid, item.token);
    };
    $('#inv-accept').onclick = async () => {
      done();
      await acceptInvite(item.token, item.pid);
    };
    $('#inv-decline').onclick = async () => {
      done();
      await C.answerInvite(item.token, { kind: 'decline' }).catch(() => {});
      closeCard(wasPaused);
    };
    overlay.querySelectorAll('[data-later]').forEach((b) => {
      b.onclick = async () => {
        done();
        await C.answerInvite(item.token, { kind: 'later', minutes: +b.dataset.later }).catch(() => {});
        toast(`Told ${item.from.name} you will be ready in ${b.dataset.later} minutes.`);
        closeCard(wasPaused);
      };
    });
  }

  // Takes the seat an invitation holds, as the given local player.
  async function acceptInvite(token, pid) {
    const me = P.findById(db, pid);
    if (!me) return toast('That player is no longer registered here.');
    let inv;
    try {
      await goOnline();
      inv = await C.readInvite(token);
      if (!inv || inv.revoked) throw new Error('This invitation is no longer valid.');
      if (C.serverNow() - inv.createdAt > RK.CLOUD.inviteTtlMs) throw new Error('This invitation has expired.');
      await C.claimInvite(token, { pid, status: 'joining' });
      await C.setSeat(inv.game, inv.seat, { ...myPerson(me), token, status: 'ready' });
      C.addFriend(pid, inv.from.pid, { name: inv.from.name, face: inv.from.face }).catch(() => {});
    } catch (err) {
      return toast(err.message);
    }
    if (game && !game.over && !isOnline()) turnToken++; // the local game is abandoned
    guestLobby(inv.game, inv.seat, inv.from.name);
  }

  // An invitation link: opened from Messages or Mail, or pasted in.
  async function handleUrl(url) {
    const token = L.parseJoinUrl(url, RK.CLOUD.scheme);
    if (!token) return toast('That is not an invitation link.');
    if (!C.configured()) return toast('Online play is not set up on this computer yet.');
    let inv;
    try {
      await C.init();
      inv = await C.readInvite(token);
    } catch (err) {
      return toast('Could not read the invitation: ' + err.message);
    }
    if (!inv || inv.revoked) return toast('This invitation is no longer valid.');
    if (C.serverNow() - inv.createdAt > RK.CLOUD.inviteTtlMs) return toast('This invitation has expired.');
    if (inv.claimed && inv.claimed.device !== C.deviceId()) return toast('This invitation was already used on another computer.');
    await C.claimInvite(token, { status: 'received' }).catch(() => {});
    showJoinFlow(inv, token);
  }

  function showJoinFlow(inv, token) {
    const mine = P.cloudProfiles(db);
    const rows = mine.map((p) => `<button class="btn big" data-join="${p.id}">${avatarHtml(p)} Join as ${esc(p.name)}</button>`).join('');
    showCard(
      `<div class="logo"><span class="mini c1" style="font-size:30px">${avatarHtml(inv.from)}</span></div>
       <h2>${esc(inv.from.name)} invites you to a game</h2>
       <p>Who is joining from this computer?</p>
       <div class="join-choices">${rows}<button class="btn big primary" id="join-new">✨ New player…</button></div>
       <button class="link" id="join-cancel">Not now</button>`,
      false
    );
    overlay.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => acceptInvite(token, b.dataset.join)));
    $('#join-new').onclick = async () => {
      await C.claimInvite(token, { status: 'registering' }).catch(() => {});
      showProfile({ name: '', face: FACE_CHOICES[mine.length % FACE_CHOICES.length], cloud: true }, async (saved) => {
        if (!saved) return showJoinFlow(inv, token);
        await goOnline();
        acceptInvite(token, saved.id);
      });
    };
    $('#join-cancel').onclick = () => (game ? closeCard(false) : showHome());
  }


  $('#btn-online').addEventListener('click', showOnlineHome);

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

  function reflectSound() {
    $('#btn-sound').textContent = settings.mute ? '🔇' : '🔊';
    if (master) master.gain.value = settings.mute ? 0 : settings.volume * settings.volume;
  }
  $('#btn-sound').addEventListener('click', () => {
    settings.mute = !settings.mute;
    saveSettings();
    reflectSound();
  });
  reflectSound();

  // The settings controls, used both in the settings window and on the
  // new-game screen.
  function settingsFormHtml() {
    const sounds = Object.entries(TURN_SOUNDS)
      .map(
        ([k, label]) => `<label class="opt"><input type="radio" name="turn-sound" value="${k}" ${settings.sound === k ? 'checked' : ''}> ${label}
          <button class="tool play" data-play="${k}" title="Play it">▶</button></label>`
      )
      .join('');
    const assist = Object.entries(ASSIST)
      .map(([k, label]) => `<option value="${k}" ${settings.assist === k ? 'selected' : ''}>${label}</option>`)
      .join('');
    return `<div class="settings">
         <div class="setting"><div class="label">End-of-turn sound</div><div class="opts">${sounds}</div></div>
         <div class="setting"><div class="label">Volume</div>
           <div class="volume"><span>🔈</span><input type="range" class="set-volume" min="0" max="100" value="${Math.round(settings.volume * 100)}"><span>🔊</span>
           <label class="opt"><input type="checkbox" class="set-mute" ${settings.mute ? 'checked' : ''}> Mute</label></div></div>
         <div class="setting"><div class="label">Move assist — what to tell me at the start of my turn</div>
           <select class="set-assist">${assist}</select></div>
         <div class="setting"><div class="label">Big-move celebration</div>
           <div class="cheer">When someone plays at least
             <input type="number" class="set-cheer-tiles" min="2" max="30" value="${settings.celebrateTiles}"> tiles in one turn, shout
             <input type="text" class="set-cheer-text" maxlength="30" value="${esc(settings.celebrateText)}" placeholder="${DEFAULT_CHEER}">
             <button class="tool play set-cheer-try" title="Try it">▶</button></div></div>
       </div>`;
  }

  function bindSettingsForm(rootEl) {
    const q = (sel) => rootEl.querySelector(sel);
    rootEl.querySelectorAll('input[name="turn-sound"]').forEach((r) =>
      r.addEventListener('change', () => {
        settings.sound = r.value;
        saveSettings();
        turnSound();
      })
    );
    rootEl.querySelectorAll('[data-play]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        turnSounds[b.dataset.play]();
      })
    );
    q('.set-volume').addEventListener('input', (e) => {
      settings.volume = +e.target.value / 100;
      reflectSound();
    });
    q('.set-volume').addEventListener('change', () => {
      saveSettings();
      clack(2);
    });
    q('.set-mute').addEventListener('change', (e) => {
      settings.mute = e.target.checked;
      saveSettings();
      reflectSound();
    });
    q('.set-assist').addEventListener('change', (e) => {
      settings.assist = e.target.value;
      saveSettings();
      if (humanTurn()) showAssist();
    });
    q('.set-cheer-tiles').addEventListener('change', (e) => {
      const n = Math.round(+e.target.value);
      settings.celebrateTiles = Number.isFinite(n) ? Math.min(30, Math.max(2, n)) : 8;
      e.target.value = settings.celebrateTiles;
      saveSettings();
    });
    q('.set-cheer-text').addEventListener('change', (e) => {
      settings.celebrateText = e.target.value.trim().slice(0, 30) || DEFAULT_CHEER;
      e.target.value = settings.celebrateText;
      saveSettings();
    });
    q('.set-cheer-try').addEventListener('click', (e) => {
      e.preventDefault();
      q('.set-cheer-text').dispatchEvent(new Event('change'));
      cheer(settings.celebrateText, `Shown when someone plays ${settings.celebrateTiles} or more tiles`);
    });
  }

  function showSettings() {
    const wasPaused = paused;
    if (game && !game.over) paused = true;
    showCard(
      `<h2>Settings</h2>${settingsFormHtml()}
       <div class="actions"><button class="btn big primary" id="set-close">Done</button></div>`,
      true
    );
    bindSettingsForm(overlay);
    $('#set-close').onclick = () => closeCard(wasPaused);
  }
  $('#btn-settings').addEventListener('click', showSettings);

  $('#btn-menu').addEventListener('click', () => {
    if (scene) endReplay();
    if (!game || game.over) return showStart();
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
      if (isOnline()) stopOnlineGame();
      paused = false;
      $('#btn-pause').textContent = '⏸';
      $('#btn-pause').classList.remove('on');
      showStart();
    };
  });

  // ---- overlays ------------------------------------------------------------

  function showCard(html, glass, size = '') {
    stopCamera();
    overlay.className = 'show' + (glass ? ' glass' : '');
    overlay.innerHTML = `<div class="card ${size}">${html}</div>`;
  }

  // Closes a window opened over the game, or over the new-game screen.
  function closeCard(wasPaused) {
    if (!game) return showHome();
    paused = wasPaused;
    hideOverlay();
    render();
  }

  function hideOverlay() {
    stopCamera();
    overlay.className = '';
    overlay.innerHTML = '';
  }

  const DEFAULT_NAMES = ['You', 'Player 1', 'Player 2', 'Player 3', 'Player 4'];
  const setup = {
    humans: 1,
    ais: 2,
    mode: 'single', // single | local | watch
    names: ['You', 'Player 2', 'Player 3', 'Player 4'],
    typed: [false, false, false, false], // seats where a name is being typed rather than picked
    faces: HUMAN_FACES.slice(),
    levels: [3, 3, 3, 3],
  };

  // Both opening screens mean "no game on the table".
  function resetToHome() {
    turnToken++;
    replayToken++;
    scene = null;
    clearHint();
    hideMoveBox();
    if (isOnline()) stopOnlineGame();
    game = null;
    $('#btn-save').disabled = true;
    layer.innerHTML = '';
  }

  const logoHtml = () =>
    `<div class="owner">Lynda's</div><div class="logo">${'RUMMI TUMMI'
      .split('')
      .map((c, i) => (c === ' ' ? '<span class="logo-gap"></span>' : `<span class="mini c${i % 4}" style="animation-delay:${i * 60}ms">${c}</span>`))
      .join('')}</div>`;

  let home = 'start'; // which opening screen a closed dialog returns to
  const showHome = () => (home === 'setup' ? showSetup() : showStart());

  // The first screen: what kind of game, or an invitation straight away.
  function showStart() {
    resetToHome();
    home = 'start';
    const known = P.invitable(db).map((p) => `<option value="${esc(p.handle)}">${esc(p.name)}</option>`).join('');
    showCard(
      `
      ${logoHtml()}
      <div class="modes">
        <button class="mode" data-mode="single"><span class="icon">🧑‍💻</span><b>Single player</b><small>You against the computer</small></button>
        <button class="mode" data-mode="local"><span class="icon">👥</span><b>Same computer</b><small>2 to 4 people take turns here</small></button>
        <button class="mode" data-mode="online"><span class="icon">🌐</span><b>Online</b><small id="start-friends"></small></button>
      </div>
      <div class="quick-invite">
        <h3>Invite a friend to play online</h3>
        <div class="quick-row">
          <input id="quick-to" list="quick-handles" placeholder="Their phone number or email (optional)"><datalist id="quick-handles">${known}</datalist>
          ${onMac ? '<button class="btn primary" id="quick-sms">💬 Send by iMessage</button>' : ''}
          <button class="btn ${onMac ? '' : 'primary'}" id="quick-mail">✉️ Email</button>
          <button class="btn" id="quick-copy">📋 Copy link</button>
        </div>
      </div>
      <div class="start-links">
        <button class="link" id="load-saved">📂 Load a saved game…</button>
        <button class="link" id="open-roster">👥 Players and statistics…</button>
        <button class="link" id="open-friends">🌐 Friends online…</button>
        <button class="link" id="open-settings">⚙ Settings…</button>
        <button class="link" id="watch">🤖 Watch the computer play…</button>
      </div>
      <div class="paste-link"><input id="paste-link" placeholder="Have an invitation link? Paste it here"><button class="tool" id="paste-join">Join</button></div>
    `,
      false,
      'wide'
    );
    overlay.querySelectorAll('.mode').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.mode === 'online') {
          if (await ensureOnlinePlayer()) hostLobby();
          return;
        }
        setup.mode = b.dataset.mode;
        showSetup();
      };
    });
    $('#watch').onclick = () => {
      setup.mode = 'watch';
      showSetup();
    };
    const to = () => $('#quick-to').value;
    if ($('#quick-sms')) $('#quick-sms').onclick = () => quickInvite('sms', to());
    $('#quick-mail').onclick = () => quickInvite('mail', to());
    $('#quick-copy').onclick = () => quickInvite('copy', to());
    $('#paste-join').onclick = () => handleUrl($('#paste-link').value);
    $('#paste-link').addEventListener('keydown', (e) => e.key === 'Enter' && handleUrl($('#paste-link').value));
    $('#load-saved').addEventListener('click', loadGame);
    $('#open-roster').addEventListener('click', showRoster);
    $('#open-friends').addEventListener('click', showOnlineHome);
    $('#open-settings').addEventListener('click', showSettings);
    reflectOnline();
  }

  // Who may sit at the table in each kind of local game: [fewest, most].
  const MODES = {
    single: { title: 'Single player', humans: [1, 1], ais: [1, 3] },
    local: { title: 'Same computer', humans: [2, 4], ais: [0, 2] },
    watch: { title: 'Watch the computer play', humans: [0, 0], ais: [2, 4] },
  };

  function showSetup() {
    resetToHome();
    home = 'setup';
    const mode = MODES[setup.mode] || MODES.single;
    const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    setup.humans = clamp(setup.humans, mode.humans);
    setup.ais = clamp(setup.ais, [mode.ais[0], Math.min(mode.ais[1], 4 - setup.humans)]);
    if (setup.humans + setup.ais < 2) setup.ais = 2 - setup.humans;
    showCard(
      `
      ${logoHtml()}
      <div class="setup-cols">
        <div class="setup-col">
          <h3>${mode.title}</h3>
          <p>${setup.mode === 'single' ? 'Choose how many computer players you face.' : setup.mode === 'watch' ? 'Choose how many computer players sit at the table.' : 'Choose who sits at the table — 2 to 4 players in total.'}</p>
          <div class="steppers">
            <div class="stepper" ${mode.humans[0] === mode.humans[1] ? 'hidden' : ''}>
              <div class="icon">🧑</div><div class="label">Human players</div>
              <div class="row"><button class="round" data-k="humans" data-d="-1">−</button><div class="val" id="v-humans"></div><button class="round" data-k="humans" data-d="1">+</button></div>
            </div>
            <div class="stepper">
              <div class="icon">🤖</div><div class="label">Computer players</div>
              <div class="row"><button class="round" data-k="ais" data-d="-1">−</button><div class="val" id="v-ais"></div><button class="round" data-k="ais" data-d="1">+</button></div>
            </div>
          </div>
          <div class="names" id="names"></div>
          <datalist id="known-names">${db.profiles.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
          <button class="link" id="open-roster">👥 Registered players and statistics…</button>
          <div class="ai-levels" id="ai-levels"></div>
        </div>
        <div class="setup-col">
          <h3>Settings</h3>
          ${settingsFormHtml()}
        </div>
      </div>
      <p class="hint" id="hint"></p>
      <div class="actions">
        <button class="btn big" id="setup-back">← Back</button>
        <button class="btn primary big" id="start">Start game</button>
      </div>
    `,
      false,
      'wide'
    );
    $('#setup-back').onclick = showStart;
    bindSettingsForm(overlay);
    $('#open-roster').addEventListener('click', showRoster);

    // the picture and statistics beside a name follow whatever is typed
    const paintSlot = (i) => {
      const row = overlay.querySelector(`.name-pick[data-slot="${i}"]`);
      if (!row) return;
      const prof = P.findByName(db, setup.names[i]);
      row.querySelector('.face-btn').innerHTML = avatarHtml(prof || { face: setup.faces[i] });
      row.querySelector('.who-stats').textContent = prof
        ? statsLine(prof.id)
        : DEFAULT_NAMES.includes(setup.names[i].trim())
          ? 'Not registered — click the picture to register'
          : 'New name — registered when the game starts';
      row.classList.toggle('known', !!prof);
    };

    const refresh = () => {
      const total = setup.humans + setup.ais;
      $('#v-humans').textContent = setup.humans;
      $('#v-ais').textContent = setup.ais;
      overlay.querySelectorAll('.round').forEach((b) => {
        const d = +b.dataset.d;
        const v = setup[b.dataset.k] + d;
        const [lo, hi] = mode[b.dataset.k];
        b.disabled = v < lo || v > hi || total + d > 4 || total + d < 2;
      });
      if (setup.humans === 1 && setup.names[0] === 'Player 1') setup.names[0] = 'You';
      if (setup.humans > 1 && setup.names[0] === 'You') setup.names[0] = 'Player 1';
      // a seat with a placeholder name takes the next registered player on
      // this computer, unless a name is being typed for it
      const inUse = () => new Set(setup.names.slice(0, setup.humans).map((n) => n.trim().toLowerCase()));
      for (let i = 0; i < setup.humans; i++) {
        if (setup.typed[i] || !DEFAULT_NAMES.includes(setup.names[i].trim())) continue;
        const free = db.profiles.find((p) => !inUse().has(p.name.toLowerCase()));
        if (free) setup.names[i] = free.name;
      }
      $('#names').innerHTML = setup.names
        .slice(0, setup.humans)
        .map((n, i) => {
          const used = new Set(setup.names.slice(0, setup.humans).map((x, k) => (k === i ? '' : x.trim().toLowerCase())));
          const mine = P.findByName(db, n);
          const options = db.profiles
            .filter((p) => p === mine || !used.has(p.name.toLowerCase()))
            .map((p) => `<option value="p:${p.id}" ${p === mine ? 'selected' : ''}>${esc(p.name)}</option>`)
            .join('');
          const typing = !mine;
          return `<div class="name-pick" data-slot="${i}">
            <button class="face-btn" data-face="${i}" title="Register or edit this player"></button>
            <div class="who">
              <div class="who-row">
                ${db.profiles.length ? `<select class="who-pick" data-i="${i}">${options}<option value="new" ${typing ? 'selected' : ''}>Type a name…</option></select>` : ''}
                <input maxlength="12" data-i="${i}" value="${esc(n)}" placeholder="Player ${i + 1}" ${typing ? '' : 'hidden'}>
              </div>
              <small class="who-stats"></small></div></div>`;
        })
        .join('');
      for (let i = 0; i < setup.humans; i++) paintSlot(i);
      $('#ai-levels').innerHTML = Array.from({ length: setup.ais }, (_, i) => {
        const buttons = [1, 2, 3, 4, 5]
          .map((l) => `<button data-ai="${i}" data-level="${l}" class="${setup.levels[i] === l ? 'on' : ''}" title="${levelName(l)}">${levelName(l)}</button>`)
          .join('');
        return `<div class="ai-row"><span class="who">🤖 Computer ${i + 1}</span><div class="levels">${buttons}</div></div>`;
      }).join('');
      $('#hint').textContent =
        setup.humans === 0
          ? 'Spectator mode — sit back and watch the computer players battle it out.'
          : setup.humans === 1
            ? `You against ${setup.ais} computer opponent${setup.ais === 1 ? '' : 's'}.`
            : 'Hot-seat mode — racks are hidden while you pass the device.';
    };
    overlay.querySelectorAll('.round').forEach((b) =>
      b.addEventListener('click', () => {
        setup[b.dataset.k] += +b.dataset.d;
        refresh();
      })
    );
    $('#names').addEventListener('input', (e) => {
      if (e.target.dataset.i === undefined || e.target.tagName !== 'INPUT') return;
      setup.names[+e.target.dataset.i] = e.target.value;
      setup.typed[+e.target.dataset.i] = true;
      paintSlot(+e.target.dataset.i);
    });
    $('#names').addEventListener('change', (e) => {
      const sel = e.target.closest('select.who-pick');
      if (!sel) return;
      const i = +sel.dataset.i;
      if (sel.value === 'new') {
        setup.typed[i] = true;
        setup.names[i] = i === 0 && setup.humans === 1 ? 'You' : `Player ${i + 1}`;
        refresh();
        const input = overlay.querySelector(`.name-pick[data-slot="${i}"] input`);
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      const prof = P.findById(db, sel.value.slice(2));
      if (!prof) return;
      setup.typed[i] = false;
      setup.names[i] = prof.name;
      setup.faces[i] = prof.face;
      refresh();
    });
    $('#names').addEventListener('click', (e) => {
      const btn = e.target.closest('.face-btn');
      if (!btn) return;
      const i = +btn.dataset.face;
      const prof = P.findByName(db, setup.names[i]);
      const typed = DEFAULT_NAMES.includes(setup.names[i].trim()) ? '' : setup.names[i];
      showProfile(prof || { name: typed, face: setup.faces[i] }, (saved) => {
        if (saved) {
          setup.names[i] = saved.name;
          setup.faces[i] = saved.face;
        }
        showSetup();
      });
    });
    $('#ai-levels').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-level]');
      if (!b) return;
      setup.levels[+b.dataset.ai] = +b.dataset.level;
      refresh();
    });
    $('#start').addEventListener('click', () => {
      const players = [];
      const used = new Set();
      for (let i = 0; i < setup.humans; i++) {
        const name = setup.names[i].replace(/\s+/g, ' ').trim().slice(0, 12) || `Player ${i + 1}`;
        if (used.has(name.toLowerCase())) return toast(`Two players are both called “${name}” — please change one.`);
        used.add(name.toLowerCase());
        // statistics are kept by name: a new name is registered on the spot,
        // the placeholder names are not
        let prof = P.findByName(db, name);
        if (!prof && !DEFAULT_NAMES.includes(name)) prof = P.saveProfile(db, { name, face: setup.faces[i] });
        players.push({
          name: prof ? prof.name : name,
          isAI: false,
          face: prof ? prof.face : setup.faces[i],
          photo: prof ? prof.photo : null,
          profileId: prof ? prof.id : null,
        });
      }
      db.lastPlayers = players.map((p) => p.name);
      saveDb();
      // each game draws different computer players, never one that shares a human's name
      const names = RK.shuffle(AI_NAMES.filter((n) => !used.has(n.toLowerCase())));
      for (let i = 0; i < setup.ais; i++) players.push({ name: names[i], isAI: true, face: AI_FACES[i], level: setup.levels[i] });
      startGame({ players });
    });
    refresh();
  }

  // ---- registered players ------------------------------------------------------

  let camStream = null;
  function stopCamera() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }

  // The list of everyone registered on this computer, with their statistics.
  function showRoster() {
    const rows = db.profiles
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (p) => `<div class="score-row" style="--pc:${PLAYER_COLORS[0]}">
          <div class="avatar">${avatarHtml(p)}</div>
          <div class="name">${esc(p.name)}</div>
          <div class="left">${statsLine(p.id)}${p.handle ? `<small class="handle">📨 ${esc(p.handle)}</small>` : ''}</div>
          <button class="tool" data-edit="${p.id}">Edit</button>
        </div>`
      )
      .join('');
    showCard(
      `<h2>Registered players</h2>
       <p>Statistics are kept for everyone registered here, from the games finished on this computer.</p>
       <div class="scores roster">${rows || '<p class="hint">Nobody is registered yet.</p>'}</div>
       <div class="actions">
         <button class="btn big" id="roster-back">Back</button>
         <button class="btn big primary" id="roster-new">Register a new player</button>
       </div>`,
      false
    );
    $('#roster-back').onclick = showHome;
    $('#roster-new').onclick = () => showProfile({ name: '', face: FACE_CHOICES[db.profiles.length % FACE_CHOICES.length] }, showRoster);
    overlay.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => showProfile(P.findById(db, b.dataset.edit), showRoster)));
  }

  // Register or edit one player. done(profile) is called with the saved
  // profile, or with null if nothing was saved.
  function showProfile(start, done) {
    const draft = {
      id: start.id || null,
      name: start.name || '',
      face: start.face || '😀',
      photo: start.photo || null,
      handle: start.handle || '',
      cloud: start.cloud === true,
    };
    const existing = !!draft.id;
    showCard(
      `<h2>${existing ? 'Edit player' : 'Register a player'}</h2>
       <div class="profile-edit">
         <div class="pic">
           <div class="avatar huge" id="pf-avatar"></div>
           <video id="pf-video" autoplay playsinline muted></video>
           <div class="pic-actions">
             <button class="btn ghost" id="pf-cam">📷 Use the camera</button>
             <button class="btn primary" id="pf-snap">Take photo</button>
             <button class="btn ghost" id="pf-nophoto">Remove photo</button>
           </div>
         </div>
         <div class="fields">
           <label>Name<input id="pf-name" maxlength="12" value="${esc(draft.name)}" placeholder="Your name"></label>
           <label>iMessage phone or email <small>optional — so this player can be invited to games in a later version</small>
             <input id="pf-handle" maxlength="100" value="${esc(draft.handle)}" placeholder="+1 555 010 2030 or name@example.com"></label>
           <label class="opt cloud-opt"><input type="checkbox" id="pf-cloud" ${draft.cloud ? 'checked' : ''}> Plays online from this computer
             <small>${C.configured() ? 'Friends will see when this player is online and can invite them' : 'Online play is not set up yet — see docs/online.md'}</small></label>
           <div class="label">Picture to use when there is no photo</div>
           <div class="face-grid">${FACE_CHOICES.map((f) => `<button type="button" data-f="${f}">${f}</button>`).join('')}</div>
           ${existing ? `<div class="pf-stats">${statsLine(draft.id)}</div>` : ''}
         </div>
       </div>
       <p class="hint" id="pf-error"></p>
       <div class="actions">
         ${existing ? '<button class="btn big danger" id="pf-delete">Delete</button>' : ''}
         <button class="btn big" id="pf-cancel">Cancel</button>
         <button class="btn big primary" id="pf-save">${existing ? 'Save' : 'Register'}</button>
       </div>`,
      false
    );
    const video = $('#pf-video');
    const paint = (live) => {
      $('#pf-avatar').innerHTML = avatarHtml(draft);
      $('#pf-avatar').style.display = live ? 'none' : '';
      video.style.display = live ? 'block' : 'none';
      $('#pf-cam').style.display = live ? 'none' : '';
      $('#pf-cam').textContent = draft.photo ? '📷 Retake photo' : '📷 Use the camera';
      $('#pf-snap').style.display = live ? '' : 'none';
      $('#pf-nophoto').style.display = !live && draft.photo ? '' : 'none';
      overlay.querySelectorAll('.face-grid button').forEach((b) => b.classList.toggle('on', b.dataset.f === draft.face));
    };
    const leave = (saved) => {
      stopCamera();
      done(saved);
    };
    paint(false);

    $('#pf-cam').onclick = async () => {
      $('#pf-error').textContent = '';
      try {
        if (window.rkStore && !(await window.rkStore.askCamera())) {
          throw new Error('camera access was not granted — allow it in System Settings › Privacy & Security › Camera');
        }
        camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
        if (!video.isConnected) return stopCamera(); // the dialog was closed while the camera was starting
        video.srcObject = camStream;
        paint(true);
      } catch (err) {
        stopCamera();
        $('#pf-error').textContent = 'Could not use the camera: ' + err.message;
      }
    };
    $('#pf-snap').onclick = () => {
      // crop the middle square and mirror it, the way the preview shows it
      const size = Math.min(video.videoWidth, video.videoHeight);
      if (!size) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.translate(192, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 192, 192);
      draft.photo = canvas.toDataURL('image/jpeg', 0.85);
      stopCamera();
      paint(false);
    };
    $('#pf-nophoto').onclick = () => {
      draft.photo = null;
      paint(false);
    };
    overlay.querySelector('.face-grid').onclick = (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      draft.face = b.dataset.f;
      paint(!!camStream);
    };
    $('#pf-cancel').onclick = () => leave(null);
    $('#pf-save').onclick = () => {
      try {
        const wasCloud = draft.id ? (P.findById(db, draft.id) || {}).cloud : false;
        const saved = P.saveProfile(db, { ...draft, name: $('#pf-name').value, handle: $('#pf-handle').value, cloud: $('#pf-cloud').checked });
        saveDb();
        if (saved.cloud) goOnline(); // publishes the new or changed record
        else if (wasCloud) C.removePlayer(saved.id).catch(() => {});
        leave(saved);
      } catch (err) {
        $('#pf-error').textContent = err.message;
      }
    };
    if (existing) {
      $('#pf-delete').onclick = () => {
        if ($('#pf-delete').dataset.sure !== 'yes') {
          $('#pf-delete').dataset.sure = 'yes';
          $('#pf-delete').textContent = 'Really delete?';
          return;
        }
        if (draft.cloud) C.removePlayer(draft.id).catch(() => {});
        P.removeProfile(db, draft.id);
        saveDb();
        leave(null);
      };
    }
  }

  async function startGame(cfg) {
    const token = ++turnToken;
    replayToken++;
    scene = null;
    clearHint();
    hideMoveBox();
    $('#log-list')._count = -1;
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
    $('#pick-title').textContent = isMe(p.id) ? 'You go first!' : `${p.name} goes first!`;
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
    if (isOnline()) {
      const gid = game.id;
      stopOnlineGame(true);
      C.endGame(gid); // only the host's computer is allowed to; others are refused quietly
      // give every computer time to see the end before the host removes the game
      if (settings.hostedGames.includes(gid)) setTimeout(tidyHostedGames, 10 * 60 * 1000);
    }
    const { winner, reason, ranking, totals } = game.result;
    if (P.recordGame(db, game)) saveDb(); // statistics for the registered players
    const w = game.players[winner];
    const youWon = isMe(w.id);
    const title = youWon ? 'You win!' : `${esc(w.name)} wins!`;
    const sub =
      reason === 'out'
        ? 'Everyone played all of their tiles.'
        : 'The pool ran dry and nobody could move — tiles left count against you.';
    showCard(
      `<div class="logo"><span class="mini c3" style="font-size:32px">🏆</span></div>
       <h1>${title}</h1><p>${sub}</p>
       <div class="scores">
        ${ranking
          .map((i, rank) => {
            const p = game.players[i];
            const left = game.rackTiles(p);
            const score = p.place ? `<div class="score plus">${ordinal(rank + 1)}</div>` : `<div class="score minus">−${totals[i]}</div>`;
            return `<div class="score-row ${i === winner ? 'winner' : ''}" style="--pc:${PLAYER_COLORS[i]}">
              <div class="place">${medal(rank + 1)}</div>
              <div class="avatar">${face(i)}</div>
              <div class="name">${esc(p.name)}</div>
              <div class="left">${left.length ? left.map((t) => miniTile(t, true)).join('') : `Went out ${ordinal(p.place)}`}${p.profileId && P.findById(db, p.profileId) ? `<small class="handle">📊 ${statsLine(p.profileId)}</small>` : ''}</div>
              ${score}
            </div>`;
          })
          .join('')}
       </div>
       <div class="actions">
         ${isOnline() ? '' : '<button class="btn big" id="again">Rematch</button>'}
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
    victory();
    if ($('#again')) $('#again').onclick = () => startGame(config);
    $('#fresh').onclick = showStart;
  }

  window.__rk = {
    get game() {
      return game;
    },
    render,
    settings,
    get db() {
      return db;
    },
    showSettings,
    showStart,
    showSetup,
    online,
    cloud: C,
    goOnline,
    handleUrl,
    hostLobby,
    get lobby() {
      return lobby;
    },
    celebrate: () => scrabalicious({ player: 0, count: 8 }),
  };

  // Settings and profiles are read from their files before anything is shown.
  async function init() {
    let saved = await store.read('settings');
    if (!saved) {
      try {
        saved = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY)); // from before the config file
      } catch (err) {
        saved = null;
      }
    }
    applySettings(saved);
    db = P.cleanDb(await store.read('profiles'));
    db.lastPlayers.forEach((name, i) => {
      if (P.findByName(db, name)) setup.names[i] = name;
    });
    reflectSound();
    showStart();
    await goOnline();
    let url = null;
    if (window.rkCloud) {
      window.rkCloud.onUrl(handleUrl);
      url = await window.rkCloud.pendingUrl();
    }
    tidyHostedGames();
    if (url) handleUrl(url);
    else offerRejoin();
  }
  init();
})();
