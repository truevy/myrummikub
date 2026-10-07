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
  // How often a player has made the first meld by turn 1, 2 and 3 (per cent),
  // from 40,000 simulated hands: scripts/meld-odds.js
  const FIRST_MELD_ODDS = [50, 57, 64];
  const RACK_PAD_X = 10;
  const RACK_PAD_Y = 8;
  const RACK_LIFT = 82; // extra room under the rack (see #bottom in the stylesheet)
  // A finger hides what it touches and has no hover; a phone held sideways is
  // also very short. Both change the layout.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const isCompact = () => window.innerHeight < 560;
  // a tablet held upright, or a narrow window: wide enough for the table, but
  // not for the buttons beside the rack or the panels beside the table
  const isNarrow = () => !isCompact() && window.innerWidth < 1000;
  // A tablet on its side, or a middling window: when the top bar cannot hold
  // every player beside the tools, the tools go into the menu and the panels
  // become drawers. Once that has been found to be needed it stays, until
  // the window or the players change: measuring it means laying the page out
  // without the drawers, and doing that on every redraw made the move log
  // slide into view for a moment (most of all while dragging).
  let squeezed = false;
  const applyFormFactor = (remeasure) => {
    const body = document.body.classList;
    body.toggle('compact', isCompact());
    body.toggle('narrow', isNarrow());
    body.toggle('touch', isTouch);
    const small = isCompact() || isNarrow();
    if (small) squeezed = false;
    if (remeasure === true) squeezed = false;
    if (small || squeezed) return body.add('drawers');
    // measured with the panels beside the table, and without animating them
    body.add('measuring');
    body.remove('drawers');
    squeezed = [...document.querySelectorAll('#players .player')].some((p) => p.scrollWidth > p.clientWidth + 1);
    body.toggle('drawers', squeezed);
    void document.body.offsetWidth;
    body.remove('measuring');
  };
  applyFormFactor(true);
  window.addEventListener('resize', () => applyFormFactor(true));
  // A phone reports its size in steps while it turns, and after the keyboard
  // goes away; the layout is done once more when things have settled.
  const settleLayout = () => {
    for (const ms of [120, 450]) {
      setTimeout(() => {
        applyFormFactor(true);
        if (game) renderInstant();
      }, ms);
    }
  };
  window.addEventListener('orientationchange', settleLayout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', settleLayout);
  window.addEventListener('pageshow', settleLayout);

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
  // The table's zoom: many small steps from "every row in view" up to three
  // times the width. The chosen tile size is remembered on this device, so
  // the table does not shrink as rows are added.
  let zoomSizes = [50];
  let activeTile = null; // a tapped tile: its group shows the handle to move it by
  const autoSort = new Map(); // player → 'runs' | 'groups': sort again after every draw
  const lastSort = new Map();
  let cw = 50; // a cell of the rack
  let ch = 66;
  let bw = 50; // a cell of the table, which can be zoomed on its own
  let bh = 66;
  let rects = {};
  const tileEls = new Map();
  const tileById = new Map();
  let dropmark = null;
  let hintIds = new Set();
  let scene = null; // a replayed board shown instead of the live one
  let replayToken = 0;
  let pausedBeforeReplay = false;

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
    parked: null, // a local game set aside while an online game is played
    logOpen: false, // the move log beside the table: folded away unless opened
    gameCenter: null, // { alias, id } while the player is logged in to Game Center
    boardTile: 0, // the table's tile width chosen with the zoom buttons; 0: the default for this screen
    appleId: null, // { name, at } while the account is tied to an Apple ID
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
    if (saved.parked && typeof saved.parked.json === 'string' && Array.isArray(saved.parked.players)) settings.parked = saved.parked;
    settings.logOpen = saved.logOpen === true;
    settings.boardTile = Number.isInteger(saved.boardTile) && saved.boardTile >= 16 && saved.boardTile <= 150 ? saved.boardTile : 0;
    if (saved.gameCenter && typeof saved.gameCenter.alias === 'string') settings.gameCenter = { alias: saved.gameCenter.alias.slice(0, 40), id: String(saved.gameCenter.id || '').slice(0, 80) };
    if (saved.appleId && typeof saved.appleId === 'object') settings.appleId = { name: String(saved.appleId.name || '').slice(0, 40), at: Number(saved.appleId.at) || 0 };
  }
  // Online play is behind a login: Game Center (iPhone and iPad) or an Apple ID.
  const isLoggedIn = () => !!(settings.appleId || settings.gameCenter);
  const saveSettings = () => store.write('settings', settings);

  let db = P.emptyDb(); // registered players and the ledger of finished games
  const saveDb = () => store.write('profiles', db);

  // ---- sound ---------------------------------------------------------------

  let audio = null;
  window.addEventListener('pointerdown', () => audio && audio.state === 'suspended' && audio.resume(), true);
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
  // Games against the computer or on one device, and games played online,
  // are counted apart.
  function statsLine(profileId) {
    const part = (label, st) => (st.games ? `${label}: ${plural(st.games, 'game')} · ${plural(st.wins, 'win')} · best move ${plural(st.bestMove, 'tile')}` : `${label}: no finished games yet`);
    const off = P.statsFor(db, profileId, 'offline');
    const on = P.statsFor(db, profileId, 'online');
    if (!off.games && !on.games) return 'No finished games yet';
    return [part('Offline', off), part('Online', on)].join('  |  ');
  }
  const statsHtml = (profileId) => statsLine(profileId).split('  |  ').map(esc).join('<br>');
  const key0 = (key) => key[0];
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function wait(ms) {
    const end = Date.now() + ms * (isOnline() ? 1 : speed); // an online game runs at one pace for everyone
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
    const stands = t.joker && t.rep ? `<i class="jv ${t.rep.colors.length === 1 ? 'c' + t.rep.colors[0] : 'multi'}">${t.rep.value}</i>` : '';
    return `<span class="mini ${cls}${small ? ' small' : ''} ${extra}">${t.joker ? '😛' + stands : t.value}</span>`;
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
          <button class="btn solve" id="hint-solve">Play tiles</button>
          <button class="btn primary" id="hint-finish">Play tiles and end turn</button>
          <button class="btn ghost" id="hint-close">Close</button>
        </div>`;
    }
    if (!$('#hint-close')) {
      box.innerHTML += '<div class="hint-actions"><button class="btn ghost" id="hint-close">Close</button></div>';
    }
    $('#hint-close').onclick = () => box.classList.remove('show');
    if ($('#hint-solve')) {
      const play = (finish) => () => {
        if (!humanTurn()) return;
        const res = game.applyHint();
        clearHint();
        if (res.ok) clack(res.count);
        if (res.ok && finish && game.endTurn().ok) return afterHumanAction();
        if (res.ok) toast(`${res.count} tile${res.count === 1 ? '' : 's'} played for you — end your turn when you are ready.`);
        render({ stagger: true });
      };
      $('#hint-solve').onclick = play(false);
      $('#hint-finish').onclick = play(true);
    }
    box.classList.add('show');
    render();
  }

  // ---- layout and rendering ------------------------------------------------

  // On a Mac the rack always shows every row it has (two at least). On a
  // phone or tablet it shows only the rows that hold tiles, so a single row
  // of tiles leaves the table more room; it grows and shrinks as they do.
  function viewRackRows() {
    if (view === null) return isTouch ? 1 : 2;
    const rack = game.players[view].rack;
    if (!isTouch) return rack.length / RACK_COLS;
    let last = -1;
    for (let i = rack.length - 1; i >= 0 && last < 0; i--) if (rack[i]) last = i;
    return Math.max(1, Math.floor(last / RACK_COLS) + 1);
  }

  function layout() {
    applyFormFactor();
    const stage = $('#stage').getBoundingClientRect();
    const W = stage.width;
    const H = window.innerHeight;
    const rackRows = viewRackRows();
    const compact = isCompact();
    const narrow = isNarrow();
    // room taken by everything that is not tiles: the bars, the margins, and
    // the space under the rack (an inch on a desktop, the safe area on a phone)
    const under = parseFloat(getComputedStyle($('#bottom')).paddingBottom) || 0;
    const chrome = (compact ? 96 : 190 + RACK_LIFT - 96) + under + (narrow ? 52 : 0); // narrow: the buttons sit under the rack
    const side = compact ? 92 : narrow ? 0 : 166;
    const byHeight = ((H - chrome) / (rowsNow() + rackRows)) * 0.76;
    const byBoard = (W - (compact ? 20 : 40)) / COLS;
    const byRack = (W - 2 * side - (compact ? 30 : 52)) / RACK_COLS;
    const size = (v) => Math.max(16, Math.min(64, Math.floor(v)));
    // The rack and the table have their own tile sizes. On a phone the rack is
    // as large as the width allows (within a third of the height) and the
    // table fills the width and scrolls; elsewhere everything fits at once.
    let whole; // the table size at which every row is in view
    if (compact) {
      cw = size(Math.min(byRack, ((H * 0.34) / rackRows) * 0.76));
      const room = H - 46 - 22 - (Math.round(cw / 0.76) * rackRows + 10) - under - 14;
      whole = size(Math.min(byBoard, (room / rowsNow()) * 0.76));
    } else {
      whole = cw = size(Math.min(byHeight, byBoard, byRack));
    }
    ch = Math.round(cw / 0.76);
    // zoom sizes: from the whole table in view, in small steps, up to three
    // times the width; the full width is always one of them
    const wide = size(byBoard);
    const top = Math.min(150, wide * 3);
    zoomSizes = [whole];
    for (let v = whole; v < top && zoomSizes.length < 16; ) {
      v = Math.max(v + 2, Math.round(v * 1.14));
      if (v > wide && zoomSizes[zoomSizes.length - 1] < wide) zoomSizes.push(wide);
      zoomSizes.push(Math.min(v, top));
    }
    zoomSizes = [...new Set(zoomSizes)].sort((a, b) => a - b);
    // the size chosen on this device, else the full width on a phone and the whole table elsewhere
    const want = settings.boardTile || (compact ? wide : whole);
    let step = 0;
    zoomSizes.forEach((v, i) => Math.abs(v - want) < Math.abs(zoomSizes[step] - want) && (step = i));
    bw = zoomSizes[step];
    bh = Math.round(bw / 0.76);
    const root = document.documentElement.style;
    root.setProperty('--cw', cw + 'px');
    root.setProperty('--ch', ch + 'px');
    root.setProperty('--bw', bw + 'px');
    root.setProperty('--bh', bh + 'px');
    root.setProperty('--rows', rowsNow());
    root.setProperty('--rack-rows', rackRows);
    const wrap = $('#table-wrap').getBoundingClientRect();
    $('#zoom-out').disabled = step === 0;
    $('#zoom-in').disabled = step === zoomSizes.length - 1;
    $('#zoom')._step = step;
    rects = {
      wrap,
      board: boardEl.getBoundingClientRect(),
      rack: rackEl.getBoundingClientRect(),
      pool: $('#pool .pool-stack').getBoundingClientRect(),
      panels: game.players.map((_, i) => $('#panel-' + i).getBoundingClientRect()),
    };
    // the zoom buttons sit in the lower right corner of the table
    $('#zoom').style.left = Math.min(rects.board.right, wrap.right) - stage.left - 84 + 'px';
    $('#zoom').style.top = Math.min(rects.board.bottom, wrap.bottom) - stage.top - 42 + 'px';
  }

  function buildPlayers() {
    squeezed = false; // other players, other widths: measured afresh on the next layout
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
        ? '<span class="num">😛</span><span class="ring">JOKER</span>'
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
      badge.textContent = p.place ? `${medal(p.place)} ${ordinal(p.place).toUpperCase()}` : p.melded ? 'ON THE BOARD' : ''; // nothing until the first meld is down
      badge.className = 'badge ' + (p.melded ? 'yes' : 'no');
    });
    $('#pool-count').textContent = game.pool.length;
  }

  function renderSets() {
    boardEl.querySelectorAll('.set-outline').forEach((el) => el.remove());
    layer.querySelectorAll('.set-handle, .set-pts').forEach((el) => el.remove());
    const mine = humanTurn();
    if (!mine) activeTile = null;
    boardEl.classList.toggle('my-turn', mine);
    const changed = scene ? scene.changed : liveChangedSets();
    for (const s of game.findSets(boardNow(), rowsNow())) {
      const el = document.createElement('div');
      let state = s.valid || scene ? 'valid' : s.tiles.length < 3 ? 'pending' : 'invalid';
      if ((s.valid || scene) && changed.has(s.idx)) state = 'changed';
      el.className = 'set-outline ' + state;
      el.style.left = s.col * bw + 'px';
      el.style.top = s.row * bh + 'px';
      el.style.width = s.tiles.length * bw + 'px';
      el.style.height = bh + 'px';
      const isNew = game.turn && s.tiles.every((t) => !game.isLocked(t));
      boardEl.appendChild(el);
      const top = rects.board.top + s.row * bh;
      const mid = rects.board.left + (s.col + s.tiles.length / 2) * bw;
      if (offTable(mid - bw / 2, top)) continue;
      // what a new set is worth towards the first meld, above the tiles where
      // nothing hides it
      if (mine && s.valid && isNew && !game.turn.startMelded) {
        const pts = document.createElement('div');
        pts.className = 'set-pts';
        pts.textContent = s.points + ' pts';
        pts.style.left = Math.min(rects.wrap.right - 4, rects.board.left + (s.col + s.tiles.length) * bw - 2) + 'px';
        pts.style.top = top + 'px';
        layer.appendChild(pts);
      }

      // the handle appears on the group that was tapped, not on every group
      if (mine && !scene && !drag && s.tiles.some((t) => t.id === activeTile) && game.canMoveSet(s.idx)) {
        const h = document.createElement('div');
        h.className = 'set-handle';
        h.dataset.idx = s.idx;
        h.title = 'Drag to move the whole group';
        // under the group, where a thumb reaches it without covering the numbers
        h.style.left = mid + 'px';
        h.style.top = top + bh - 1 + 'px';
        layer.appendChild(h);
      }
    }
  }

  function renderControls() {
    reflectSwitch();
    const mine = humanTurn();
    const status = mine ? game.turnStatus() : null;
    const viewedHuman = view !== null && !game.players[view].isAI && !game.over;
    $('#btn-sort-runs').disabled = !viewedHuman;
    $('#btn-sort-groups').disabled = !viewedHuman;
    $('#btn-sort-runs').classList.toggle('auto', autoSort.get(view) === 'runs');
    $('#btn-sort-groups').classList.toggle('auto', autoSort.get(view) === 'groups');
    $('#btn-hint').disabled = !mine || isOnline();
    $('#btn-hint').hidden = isOnline(); // no hints in an online game
    $('#btn-reset').disabled = !mine || status.placed === 0;
    $('#btn-undo').disabled = !mine || status.placed === 0;
    $('#btn-draw').disabled = !mine;
    $('#btn-end').disabled = !mine || !status.canEnd;
    $('#btn-draw').textContent = !game.pool.length ? 'Pass' : status && status.placed ? 'Take back & draw' : 'Draw tile';
    $('#btn-save').disabled = game.over || isOnline();
    document.body.classList.toggle('online-game', isOnline());
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

  // a cell of the table that is scrolled out of sight
  const offTable = (x, y) =>
    y < rects.wrap.top - bh / 4 || y + bh > rects.wrap.bottom + bh / 4 || x < rects.wrap.left - bw / 4 || x + bw > rects.wrap.right + bw / 4;

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
    if (!scene) for (const s of game.findSets()) if (!s.valid) s.tiles.forEach((t) => badIds.add(t.id));
    boardNow().forEach((t, i) => {
      if (!t) return;
      const locked = game.turn ? game.isLocked(t) : true;
      target.set(t.id, {
        x: rects.board.left + (i % COLS) * bw + 2,
        y: rects.board.top + Math.floor(i / COLS) * bh + 2,
        key: 'b' + i,
        out: offTable(rects.board.left + (i % COLS) * bw, rects.board.top + Math.floor(i / COLS) * bh),
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
      if (el.classList.contains('dragging')) continue; // it follows the finger, not the grid
      const moved = el._key !== tg.key;
      el.style.transitionDelay = opts.stagger && moved ? Math.min(n++ * 40, 1000) + 'ms' : '0ms';
      el.style.transform = `translate(${tg.x}px, ${tg.y}px)` + (tg.hidden ? ' scale(.35)' : '');
      el.style.zIndex = moved ? 10 : 2;
      el.classList.toggle('hidden', !!tg.hidden);
      el.classList.toggle('out', !!tg.out);
      el.classList.toggle('onboard', key0(tg.key) === 'b'); // table tiles take the table's size
      el.classList.toggle('fixed', !tg.movable);
      el.classList.toggle('fresh', !!tg.fresh && !tg.bad);
      el.classList.toggle('bad', !!tg.bad);
      el.classList.toggle('last', !!tg.last && !tg.fresh);
      el.classList.toggle('hint', hintIds.has(id) && key0(tg.key) === 'r');
      el._key = tg.key;
      el._x = tg.x;
      el._y = tg.y;
    }
    paintJokers();
  }

  // The lower half of a joker shows the tile it stands for. A joker that has
  // just been freed shows nothing and gets a moving border until it is used.
  function paintJokers() {
    const view = scene ? new Map() : game.jokerView();
    for (const t of game.jokers) {
      const el = tileEls.get(t.id);
      if (!el) continue;
      const onTable = boardNow().includes(t);
      const info = scene ? (onTable && t.rep ? { value: t.rep.value, colors: t.rep.colors, pending: false } : null) : view.get(t.id);
      let html = 'JOKER';
      if (info && info.value) {
        const one = info.colors.length === 1;
        html = `<b class="jv ${one ? 'c' + info.colors[0] : 'multi'}">${info.value}</b>`;
        if (!one) html += `<span class="jdots">${info.colors.map((c) => `<i class="c${c}"></i>`).join('')}</span>`;
      }
      if (el._joker !== html) {
        el.querySelector('.ring').innerHTML = html;
        el._joker = html;
      }
      el.classList.toggle('stands', !!(info && info.value));
      el.classList.toggle('joker-pending', !!(info && info.pending));
      el.title = info && info.value ? `This joker stands for ${info.value}${info.colors.length === 1 ? ' ' + RK.COLOR_NAMES[info.colors[0]] : ''} until the real tile replaces it` : info && info.pending ? 'Freed — use this joker in a set this turn' : '';
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
    box.querySelector('.close').onclick = hideMoveBox;
    box.classList.add('show');
    // During play the card only stays a few seconds, so it never sits over
    // the table while the next player thinks. A replay keeps it until closed.
    clearTimeout(moveBoxTimer);
    if (!replay) moveBoxTimer = setTimeout(hideMoveBox, MOVE_BOX_MS);
  }

  const MOVE_BOX_MS = 4000;
  let moveBoxTimer = 0;
  function hideMoveBox() {
    clearTimeout(moveBoxTimer);
    $('#movebox').classList.remove('show');
  }
  // reading it keeps it open; moving away lets it go shortly after
  $('#movebox').addEventListener('mouseenter', () => clearTimeout(moveBoxTimer));
  $('#movebox').addEventListener('mouseleave', () => {
    clearTimeout(moveBoxTimer);
    if (!scene) moveBoxTimer = setTimeout(hideMoveBox, 1500);
  });

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

  // The move log starts folded away on every device; opening it is remembered.
  function reflectLog() {
    $('#log').classList.toggle('closed', !settings.logOpen);
    $('#log-toggle').textContent = settings.logOpen ? '‹' : '›';
  }
  $('#log-toggle').addEventListener('click', () => {
    settings.logOpen = !settings.logOpen;
    saveSettings();
    reflectLog();
    setTimeout(renderInstant, 260);
    renderInstant();
  });

  $('#log-live').addEventListener('click', endReplay);

  $('#chat-toggle').addEventListener('click', () => {
    const closed = $('#chat').classList.toggle('closed');
    $('#chat-toggle').textContent = closed ? '‹' : '›';
    if (!closed) {
      $('#chat-unread').textContent = '';
      $('#chat-list').scrollTop = $('#chat-list').scrollHeight;
    }
    renderInstant();
  });

  // ---- zooming the table -----------------------------------------------------

  // Zooming is this screen's own business: nobody else's table changes.
  const zoomBy = (d) => () => {
    const step = Math.max(0, Math.min(zoomSizes.length - 1, $('#zoom')._step + d));
    settings.boardTile = zoomSizes[step];
    saveSettings();
    renderInstant();
    requestAnimationFrame(renderInstant); // once more, with the scrolled table measured
  };
  $('#zoom-in').addEventListener('click', zoomBy(1));
  $('#zoom-out').addEventListener('click', zoomBy(-1));
  {
    const wrap = $('#table-wrap');
    // the tiles sit in a layer above the table, so they follow its scrolling here
    let queued = false;
    wrap.addEventListener('scroll', () => {
      if (queued || drag) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        renderInstant();
      });
    });
    // that layer also swallows the wheel, and a finger on a tile that cannot
    // be moved: both scroll the table
    layer.addEventListener(
      'wheel',
      (e) => {
        wrap.scrollTop += e.deltaY;
        wrap.scrollLeft += e.deltaX;
      },
      { passive: true }
    );
    let pan = null;
    layer.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.tile.fixed');
      const scrolls = wrap.scrollHeight > wrap.clientHeight + 1 || wrap.scrollWidth > wrap.clientWidth + 1;
      if (scrolls && el && String(el._key)[0] === 'b') pan = { x: e.clientX, y: e.clientY, top: wrap.scrollTop, left: wrap.scrollLeft, id: e.pointerId };
    });
    window.addEventListener('pointermove', (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      wrap.scrollTop = pan.top - (e.clientY - pan.y);
      wrap.scrollLeft = pan.left - (e.clientX - pan.x);
    });
    const endPan = (e) => pan && e.pointerId === pan.id && (pan = null);
    window.addEventListener('pointerup', endPan);
    window.addEventListener('pointercancel', endPan);
  }

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
    const items = set.tiles.map((t, i) => ({ el: tileEls.get(t.id), dx: i * bw }));
    const first = items[0].el;
    drag = { kind: 'set', fromIdx: set.idx, len: set.len, items, w: bw, h: bh, last: e, offX: e.clientX - first._x, offY: e.clientY - first._y + fingerLift(e) };
    beginDrag(e);
  }

  function beginDrag(e) {
    $('#hintbox').classList.remove('show');
    hideMoveBox();
    drag.items.forEach((it) => it.el.classList.add('dragging'));
    // One finger drives a drag from start to finish: its events keep coming
    // here wherever it goes, and another finger or a resting palm is ignored.
    drag.pointerId = e.pointerId;
    try {
      layer.setPointerCapture(e.pointerId);
    } catch (err) {
      // a pointer that is already gone: the drag ends with the next event
    }
    // under a finger the tile rises above the touch point; a short glide
    // makes that a lift rather than a jump
    if (e.pointerType === 'touch') {
      const els = drag.items.map((it) => it.el);
      els.forEach((el) => el.classList.add('lifting'));
      setTimeout(() => els.forEach((el) => el.classList.remove('lifting')), 110);
    }
    layer.querySelectorAll('.set-handle, .set-pts').forEach((el) => el.remove());
    // a drag passing over the chat must not select its text
    document.body.classList.add('dragging-tiles');
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    moveDrag(e);
  }

  function onDown(e) {
    if (e.button !== 0 || drag || !game || game.over) return;
    if (e.target.closest('.tile, .set-handle')) e.preventDefault(); // no text selection starts from a tile
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
      const grabSet = (ev) => {
        const set = game.setAt(loc.idx);
        startSetDrag(set.idx, ev);
        drag.offX += (loc.idx - set.idx) * bw;
        moveDrag(ev);
      };
      if (e.shiftKey && game.canMoveSet(loc.idx)) return grabSet(e);
      // holding a tile still for a moment picks up its whole group
      const set = game.setAt(loc.idx);
      if (set && set.len > 1 && game.canMoveSet(loc.idx)) {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          if (!drag || drag.kind !== 'tile' || drag.items[0].el !== el || drag.moved) return;
          const at = drag.last;
          cancelAnimationFrame(drag.raf);
          el.classList.remove('dragging');
          drag = null;
          grabSet(at);
          tone(520, 780, 0.12, 0.1, 0.04, 'sine');
        }, 450);
      }
    }
    drag = { kind: 'tile', from: loc, items: [{ el, dx: 0 }], offX: e.clientX - el._x, offY: e.clientY - el._y + fingerLift(e), downX: e.clientX, downY: e.clientY, last: e, w: loc.area === 'board' ? bw : cw, h: loc.area === 'board' ? bh : ch };
    beginDrag(e);
  }
  let holdTimer = 0;

  // under a finger the dragged tile rides a little above the touch point, so
  // it and the cell it will land in stay visible
  const fingerLift = (e) => (e.pointerType === 'touch' ? Math.round(Math.max(ch, bh) * 0.9) : 0);

  function dropTarget(e) {
    const x = e.clientX - drag.offX + (drag.w - 4) / 2;
    const y = e.clientY - drag.offY + (drag.h - 4) / 2;
    const b = rects.board;
    const wr = rects.wrap;
    if (x >= Math.max(b.left, wr.left) && x < Math.min(b.right, wr.right) && y >= Math.max(b.top, wr.top) && y < Math.min(b.bottom, wr.bottom)) {
      if (!humanTurn()) return null;
      let col = Math.floor((x - b.left) / bw);
      const row = Math.floor((y - b.top) / bh);
      if (drag.kind === 'set') col = Math.min(col, COLS - drag.len);
      const idx = row * COLS + col;
      const len = drag.kind === 'set' ? drag.len : 1;
      const bad = drag.kind === 'set' && !game.setFits(drag.fromIdx, idx);
      return { area: 'board', idx, bad, x: b.left + col * bw, y: b.top + row * bh, w: len * bw, h: bh };
    }
    if (drag.kind !== 'tile') return null;
    const r = rects.rack;
    const rx = x - r.left - RACK_PAD_X;
    const ry = y - r.top - RACK_PAD_Y;
    const shown = viewRackRows();
    // a tile held just under the last row that shows starts a new row there
    const rows = Math.min(shown + 1, view === null ? shown : game.players[view].rack.length / RACK_COLS);
    if (rx >= -cw / 2 && rx < RACK_COLS * cw + cw / 2 && ry >= -ch / 2 && ry < shown * ch + ch / 2) {
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
        h: ch,
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
    dropmark.style.height = tg.h + 'px';
  }

  // While a dragged tile is held at an edge of a table that scrolls, the
  // table moves under it, so every row can be reached without letting go.
  // Returns true while it is scrolling.
  function edgeScroll(e) {
    const wrapEl = $('#table-wrap');
    const r = rects.wrap;
    const x = e.clientX - drag.offX + drag.w / 2;
    const y = e.clientY - drag.offY + drag.h / 2;
    const zone = Math.max(30, bh * 0.6);
    let dx = 0;
    let dy = 0;
    if (x > r.left - 10 && x < r.right + 10 && y > r.top - bh && y < r.bottom) {
      if (y < r.top + zone && wrapEl.scrollTop > 0) dy = -1;
      else if (y > r.bottom - zone && wrapEl.scrollTop < wrapEl.scrollHeight - wrapEl.clientHeight - 1) dy = 1;
      if (x < r.left + zone && wrapEl.scrollLeft > 0) dx = -1;
      else if (x > r.right - zone && wrapEl.scrollLeft < wrapEl.scrollWidth - wrapEl.clientWidth - 1) dx = 1;
    }
    if (!dx && !dy) {
      drag.edgeSince = 0;
      return false;
    }
    // a tile only passing through the edge on its way does not scroll anything
    if (!drag.edgeSince) drag.edgeSince = performance.now();
    if (performance.now() - drag.edgeSince < 280) return true;
    const step = Math.max(6, Math.round(bh * 0.14));
    wrapEl.scrollTop += dy * step;
    wrapEl.scrollLeft += dx * step;
    renderInstant(); // the other tiles follow the table; the dragged one is left alone
    return true;
  }

  // The drag is drawn once per frame, however often the finger reports in.
  function dragFrame() {
    if (!drag) return;
    drag.raf = 0;
    moveDrag(drag.last);
    if (edgeScroll(drag.last)) drag.raf = requestAnimationFrame(dragFrame);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.last = e;
    if (drag.downX !== undefined && Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 8) drag.moved = true;
    if (!drag.raf) drag.raf = requestAnimationFrame(dragFrame);
  }

  function onUp(e) {
    if (drag && e.pointerId !== drag.pointerId) return; // some other finger
    clearTimeout(holdTimer);
    document.body.classList.remove('dragging-tiles');
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    // the system took the touch away (a gesture, a call): nothing is dropped
    if (e.type === 'pointercancel') {
      drag.items.forEach((it) => it.el.classList.remove('dragging', 'lifting'));
      dropmark.style.display = 'none';
      drag = null;
      return render();
    }
    // released tiles settle into place quickly instead of gliding there
    const dropped = drag.items.map((it) => it.el);
    dropped.forEach((el) => el.classList.add('settle'));
    setTimeout(() => dropped.forEach((el) => el.classList.remove('settle')), 220);
    const tap = drag.kind === 'tile' && !drag.moved;
    const tg = tap ? null : dropTarget(e);
    drag.items.forEach((it) => it.el.classList.remove('dragging'));
    dropmark.style.display = 'none';
    // a tap moves nothing: on the table it picks the group to show a handle for
    if (tap) activeTile = drag.from.area === 'board' ? +drag.items[0].el.dataset.id : null;
    if (tg) {
      const freedBefore = game.turn ? game.releasedJokers().size : 0;
      const res =
        drag.kind === 'tile'
          ? game.moveTile(view, drag.from, { area: tg.area, idx: tg.idx })
          : game.moveSet(view, drag.fromIdx, tg.idx);
      if (res.ok) clack(drag.items.length);
      else if (res.reason) toast(res.reason);
      if (res.ok && game.turn && game.releasedJokers().size > freedBefore) {
        toast('Joker freed — use it in a set before you end your turn.');
        tone(660, 990, 0.2, 0.14, 0.05, 'sine');
      }
    }
    drag = null;
    render();
  }

  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('contextmenu', (e) => e.preventDefault()); // no menu from a long press on a tile
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

  function confetti(into, count = 90) {
    const colors = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#f08a00', '#fff'];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 300 - 150).toFixed(0) + 'px');
      c.style.setProperty('--rot', (Math.random() * 1400 - 700).toFixed(0) + 'deg');
      c.style.animationDuration = (2.5 + Math.random() * 3).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's';
      into.appendChild(c);
    }
  }

  // The first player to play every tile has won: the whole screen says so.
  // The game then carries on for the other places. Resolves when the screen
  // is tapped away, or by itself after a few seconds.
  function showWinner(playerIdx) {
    return new Promise((resolve) => {
      const p = game.players[playerIdx];
      const others = game.players.length - 1;
      const el = document.createElement('div');
      el.id = 'winner';
      el.innerHTML = `<div class="winner-card">
          <div class="trophy">🏆</div>
          <div class="who"><span class="avatar">${face(playerIdx)}</span></div>
          <h1>${isMe(playerIdx) ? 'You win!' : esc(p.name) + ' wins!'}</h1>
          <p>First to play every tile.</p>
          <p class="next">The game goes on: ${others === 1 ? 'the other player plays' : 'the others play'} out their tiles.</p>
          <button class="btn primary big" id="winner-go">Keep playing</button>
        </div>`;
      document.body.appendChild(el);
      confetti(el);
      victory();
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        el.classList.add('gone');
        setTimeout(() => el.remove(), 500);
        resolve();
      };
      el.querySelector('#winner-go').onclick = close;
      el.addEventListener('pointerdown', (e) => e.target === el && close());
      setTimeout(close, 9000);
    });
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
      if (action.place === 1 && !game.over) await showWinner(action.player);
      else await wait(action.place ? 3200 : action.type === 'play' ? 2600 : 800);
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
    if (game.lastAction.place === 1 && !game.over) await showWinner(game.lastAction.player);
    // several people sharing this device: the tile just drawn stays in view a
    // second longer before the rack is hidden for the next player
    else await sleep(game.lastAction.place ? 2200 : game.lastAction.type === 'draw' ? 1100 + (humans() > 1 ? 1000 : 0) : 700);
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
    const who = game.current;
    game.drawAndPass();
    if (autoSort.has(who)) game.sortRack(game.players[who], autoSort.get(who));
    afterHumanAction();
  });

  $('#btn-undo').addEventListener('click', () => {
    if (!humanTurn()) return;
    if (game.undoLast().ok) clack();
    clearHint();
    render({ stagger: true });
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

  // Tapping a sort button sorts the rack once. Tapping the same one again
  // keeps the rack sorted that way after every tile drawn; a third tap, or
  // the other button, ends that.
  for (const [id, mode] of [['#btn-sort-runs', 'runs'], ['#btn-sort-groups', 'groups']]) {
    $(id).addEventListener('click', () => {
      if (view === null || game.players[view].isAI || game.over) return;
      if (autoSort.get(view) === mode) {
        autoSort.delete(view);
        lastSort.delete(view);
        toast('Auto-sort is off.');
      } else if (lastSort.get(view) === mode) {
        autoSort.set(view, mode);
        toast('Auto-sort is on: your rack is sorted again after every tile you draw.');
      } else {
        autoSort.delete(view);
        lastSort.set(view, mode);
      }
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

  const SAVE_EXT = '.rummitime';

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
      input.accept = SAVE_EXT + ',.rummikub,application/json';
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
      const name = await writeFile(`Rummi Time ${stamp}${SAVE_EXT}`, text);
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
      if (!data || !['rummi-tummi', 'rummi-tumi', 'lyndas-rummikub', 'tinas-rummikub'].includes(data.app)) throw new Error('This file is not a saved Rummi Time game.');
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

  let online = { ready: false, error: null, connected: false, friends: [], stopFriends: null, stopConn: null, clashes: new Set(), rankings: null };

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
      for (const p of mine) {
        await C.publishPlayer(p);
        // a name belongs to whoever registered it first
        if ((await C.claimName(p.name, p.id)) === false && !online.clashes.has(p.id)) {
          online.clashes.add(p.id);
          toast(`Another online player is already called “${p.name}”. Give ${p.name} a different name under Players and statistics.`);
        }
      }
      await C.setPresence(mine.map((p) => p.id), game && config && config.online ? game.id : null);
      watchMyGames();
      enablePush();
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
    if (line) line.textContent = online.ready ? L.summaryText(summary) : isLoggedIn() ? 'Play friends on their own computers' : 'Log in to play friends on their own computers';
  }

  // The global table (online games only), with this computer's players
  // picked out, and listed underneath when they are not among the top ten.
  function rankingsHtml() {
    if (!online.rankings) return `<p class="hint">${online.rankError ? 'The rankings could not be loaded.' : 'Loading the rankings…'}</p>`;
    if (!online.rankings.length) return '<p class="hint">Nobody has finished an online game yet. The first winner tops the table.</p>';
    const mine = new Set(P.cloudProfiles(db).map((p) => p.id));
    const row = (r) => `<div class="rank-row${mine.has(r.pid) ? ' me' : ''}"><b class="pos">${r.rank}</b><span class="avatar">${esc(r.face)}</span>
        <span class="name">${esc(r.name)}${mine.has(r.pid) ? ' <small>you</small>' : ''}</span>
        <span class="wins">${r.wins} win${r.wins === 1 ? '' : 's'}</span><span class="played">${r.games} game${r.games === 1 ? '' : 's'} · ${Math.round((100 * r.wins) / r.games)}%</span></div>`;
    const top = online.rankings.slice(0, 10);
    const rest = online.rankings.filter((r) => mine.has(r.pid) && !top.includes(r));
    const unranked = P.cloudProfiles(db).filter((p) => !online.rankings.some((r) => r.pid === p.id));
    return `<div class="rank-list">${top.map(row).join('')}${rest.length ? '<div class="rank-gap">⋯</div>' + rest.map(row).join('') : ''}</div>
      ${unranked.length ? `<p class="hint">${esc(unranked.map((p) => p.name).join(', '))}: not ranked yet — finish an online game to join the table.</p>` : ''}`;
  }

  // Fetched when the Online window opens, and again after a finished game.
  async function loadRankings() {
    if (!online.ready || online.rankLoading || (online.rankings && Date.now() - online.rankAt < 60000)) return;
    online.rankLoading = true;
    try {
      online.rankings = await C.readRankings();
      online.rankError = false;
      online.rankAt = Date.now();
    } catch (err) {
      online.rankError = true;
    }
    online.rankLoading = false;
    if ($('#rank-box')) $('#rank-box').innerHTML = rankingsHtml();
  }

  // How the player is logged in: Game Center (iPhone and iPad) and the Apple
  // ID that carries the account to other devices. Either can be added to the
  // other, and Log out ends both.
  function accountHtml() {
    const rows = [];
    if (window.rkGameCenter) {
      rows.push(
        settings.gameCenter
          ? `<div class="account-row"><span>🎮 Logged in to Game Center as <b>${esc(settings.gameCenter.alias)}</b></span><button class="tool" id="gc-show">🏆 Game Center rankings</button></div>`
          : `<div class="account-row"><button class="btn" id="gc-signin">🎮 Log in to Game Center</button><small>Optional — your wins also go to Game Center's leaderboard.</small></div>`
      );
    }
    rows.push(
      settings.appleId
        ? `<div class="account-row"><span class="pill online">Signed in with Apple${settings.appleId.name ? ` as ${esc(settings.appleId.name)}` : ''}</span><small>Your games follow you to every device you sign in on.</small></div>`
        : `<div class="account-row"><button class="apple-btn" id="apple-signin"> Sign in with Apple</button><small>Optional — to play the same games on your other devices.</small></div>`
    );
    rows.push(`<div class="account-row"><button class="btn" id="log-out">Log out</button><small>You stay logged in until you log out, even after the app is closed.</small></div>`);
    return `<h3>Account</h3><div class="account">${rows.join('')}</div>`;
  }

  // The Online button: the login window first, then the online window.
  async function openOnline() {
    if (!C.configured()) return toast('Online play is not set up on this computer yet.');
    if (!isLoggedIn()) return showOnlineLogin();
    if (game) return showOnlineHome(); // during a game: no new players are set up
    if (await ensureOnlinePlayer()) showOnlineHome();
  }

  // Shown until the player is logged in, over the game if one is running.
  function showOnlineLogin() {
    const wasPaused = paused;
    if (game && !game.over) paused = true;
    showCard(
      `<div class="online-login"><div class="logo"><span class="mini c0" style="font-size:30px">🌐</span></div>
       <h2>Online</h2>
       <p>Log in to play friends on their own devices. Your games, rankings and players follow you to every device you log in on, and you stay logged in until you log out.</p>
       <div class="login-choices">
         ${window.rkGameCenter ? '<button class="btn big primary" id="login-gc">🎮 Log in with Game Center</button>' : ''}
         <button class="apple-btn big" id="login-apple"> Sign in with Apple</button>
       </div>
       ${window.rkApple ? '' : '<p class="hint">Sign in with Apple opens in your browser and brings you back here when it is done.</p>'}
       <div class="actions"><button class="btn big" id="login-cancel">Not now</button></div></div>`,
      true
    );
    if ($('#login-gc')) $('#login-gc').onclick = signInToGameCenter;
    $('#login-apple').onclick = signInWithAppleId;
    $('#login-cancel').onclick = () => closeCard(wasPaused);
  }

  function showOnlineHome() {
    const mine = P.cloudProfiles(db);
    const summary = L.friendsSummary(online.friends);
    const pill = (state) => `<span class="pill ${state}">${state === 'playing' ? 'Playing now' : state === 'online' ? 'Online' : 'Offline'}</span>`;
    let body;
    if (!C.configured()) {
      body = `<p class="hint">Online play is not set up yet. Follow <b>docs/online.md</b> once, then paste the connection details into <b>src/config.js</b>.</p>`;
    } else if (!mine.length) {
      body = `<p class="hint">Nobody on this computer plays online yet. Register a player and tick <b>Plays online from this device</b>.</p>`;
    } else {
      const you = mine
        .map((p) => `<div class="online-row"><div class="avatar">${avatarHtml(p)}</div><div class="name">${esc(p.name)}</div>
            <span class="pill ${online.ready && online.connected ? 'online' : 'offline'}">${online.ready ? (online.connected ? 'Online' : 'Reconnecting…') : online.error ? 'Not connected' : 'Connecting…'}</span></div>`)
        .join('');
      const friends = summary.list
        .map((f) => `<div class="online-row"><div class="avatar">${avatarHtml(f)}</div><div class="name">${esc(f.name)}<small>${esc(L.lastAvailableText(f.presence, C.serverNow()))}</small></div>${pill(f.state)}
            ${f.state === 'online' ? `<button class="tool" data-invite-friend="${f.pid}">Invite to join my game</button>` : ''}</div>`)
        .join('');
      body = `<div class="online-status">${esc(L.summaryText(summary))}</div>
        <div class="actions online-actions">
          <button class="btn big primary" id="online-host" ${online.ready ? '' : 'disabled'}>🎲 Start an online game</button>
          <div class="menu-wrap">
            <button class="btn big" id="online-invite" ${online.ready ? '' : 'disabled'}>✉️ Invite a friend ▾</button>
            <div class="menu" id="invite-menu" hidden>
              ${onMac ? '<button data-invite-by="sms">💬 Send by iMessage</button>' : ''}
              <button data-invite-by="mail">✉️ Send by email</button>
              <button data-invite-by="copy">📋 Copy an invitation link</button>
            </div>
          </div>
          <button class="btn big" id="online-join">🔗 Join with a link</button>
        </div>
        <h3>You</h3><div class="online-list">${you}</div>
        ${accountHtml()}
        ${myGames.size || settings.parked ? `<h3>Your games</h3><div class="games-box">${gamesListHtml(false)}</div>` : ''}
        <h3>Rankings</h3><div id="rank-box">${rankingsHtml()}</div>
        <h3>Recent players</h3><div class="online-list">${friends || '<p class="hint">People appear here after you have played a game online together.</p>'}</div>
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
    if ($('#online-invite')) {
      $('#online-invite').onclick = () => ($('#invite-menu').hidden = !$('#invite-menu').hidden);
      overlay.querySelectorAll('[data-invite-by]').forEach((b) => (b.onclick = () => quickInvite(b.dataset.inviteBy, '')));
    }
    if ($('#online-join')) $('#online-join').onclick = () => showPasteLink(openOnline);
    if ($('#apple-signin')) $('#apple-signin').onclick = signInWithAppleId;
    if ($('#gc-signin')) $('#gc-signin').onclick = signInToGameCenter;
    if ($('#gc-show')) $('#gc-show').onclick = () => window.rkGameCenter.show().catch((err) => toast(String(err && err.message ? err.message : err)));
    if ($('#log-out')) $('#log-out').onclick = () => logOut(wasPaused);
    bindGamesList(overlay);
    loadRankings();
    if ($('#online-host')) $('#online-host').onclick = () => hostLobby();
    overlay.querySelectorAll('[data-invite-friend]').forEach((b) => (b.onclick = () => hostLobby(b.dataset.inviteFriend)));
  }

  // ---- push notifications (iPhone and iPad) -------------------------------------
  //
  // "Your turn" and invitations reach a closed app through Apple's push
  // service: the device's token is kept with the account, and a small
  // function at Firebase sends the notifications (functions/index.js).

  let pushAsked = false;
  async function enablePush() {
    if (!window.rkPush || pushAsked) return;
    pushAsked = true;
    try {
      const reg = await window.rkPush.register();
      if (reg && reg.token) await C.savePushToken(reg.token, reg.env === 'sandbox' ? 'sandbox' : 'production');
    } catch (err) {
      // no push on this device: the banner inside the game still works
    }
  }

  // a notification was tapped: open that game
  window.__rkOpenGame = (gid) => {
    if (!L.isId(gid)) return;
    if (!isLoggedIn()) return showOnlineLogin();
    const go = () => (online.ready ? openGame(gid) : setTimeout(go, 500));
    go();
  };

  // ---- Sign in with Apple ---------------------------------------------------------
  //
  // The Apple ID becomes the key to the account: every device signed in with
  // it plays as the same players, without codes. On an iPhone or iPad it is
  // Apple's own sheet; on a Mac or PC the browser does the sign-in and the
  // result arrives as a link that opens the app.

  const SIGNIN_URL = 'https://lyndas-rummikub.web.app/signin.html';

  // A sign-in started here sends a one-time value through the browser, and the
  // link that comes back must carry it. Any other sign-in link was not asked
  // for by this app (someone may be trying to tie their own Apple ID to this
  // account, or switch it to theirs) and is ignored.
  const AUTH_STATE_KEY = 'rk-auth-state';
  const AUTH_STATE_TTL_MS = 15 * 60 * 1000;
  let authStateHere = null; // { state, at }, when the browser's storage is unavailable
  function newAuthState() {
    const pending = { state: RK.newId(), at: Date.now() };
    authStateHere = pending;
    try {
      localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(pending));
    } catch (err) {
      // kept in memory only
    }
    return pending.state;
  }
  // true once for the value of the sign-in started here; it cannot be used again
  function takeAuthState(state) {
    let pending = authStateHere;
    try {
      pending = JSON.parse(localStorage.getItem(AUTH_STATE_KEY)) || pending;
    } catch (err) {
      // the in-memory value decides
    }
    if (!state || !pending || pending.state !== state || !(Date.now() - pending.at < AUTH_STATE_TTL_MS)) return false;
    authStateHere = null;
    try {
      localStorage.removeItem(AUTH_STATE_KEY);
    } catch (err) {
      // nothing stored
    }
    return true;
  }

  async function signInWithAppleId() {
    if (window.rkApple) return signInWithApple();
    const url = `${SIGNIN_URL}?provider=apple&state=${newAuthState()}`;
    if (window.rkWebAuth) {
      // a web session inside the app that comes back with the result
      try {
        const back = await window.rkWebAuth.open(url);
        if (back) handleAuthUrl(back);
      } catch (err) {
        toast(String(err && err.message ? err.message : err));
      }
      return;
    }
    await openExternal(url);
    toast('Finish signing in in your browser — the game carries on here when it is done.');
  }

  function handleAuthUrl(url) {
    const auth = L.parseAuthUrl(url, RK.CLOUD.scheme);
    if (!auth) return;
    if (!takeAuthState(auth.state)) return toast('That sign-in link was not started here, so it was ignored.');
    if (auth.error) return toast(auth.error);
    finishSignIn('Apple', () => C.signInWithCredentialJson(auth.credential, 'Apple'), auth.name);
  }

  async function signInWithApple(done) {
    let apple;
    try {
      apple = await window.rkApple.signIn();
      if (!apple || !apple.idToken) throw new Error('Apple did not return a sign-in.');
    } catch (err) {
      toast(String(err && err.message ? err.message : err));
      return done && done(false);
    }
    return finishSignIn('Apple', () => C.signInWithApple(apple), apple.name, done);
  }

  // After Apple said yes: the account either gains the sign-in, or this
  // device joins the account that Apple ID already has.
  async function finishSignIn(label, signIn, displayName, done) {
    const own = P.cloudProfiles(db);
    try {
      const { switched, players } = await signIn();
      if (switched) {
        if (!players.length) throw new Error('That Apple ID has an account without online players; this device keeps its own.');
        const theirs = new Set(players.map((p) => p.id));
        for (const p of db.profiles) if (p.cloud && !theirs.has(p.id)) p.cloud = false;
        players.forEach((p) => P.adoptProfile(db, p));
        saveDb();
        online.rankings = null;
        online.clashes.clear();
        await goOnline();
      }
      settings.appleId = { name: String(displayName || '').slice(0, 40), at: Date.now() };
      saveSettings();
      reflectOnline();
      if (done) return done(true);
      showSignedIn(label, switched ? players : own);
    } catch (err) {
      toast(String(err && err.message ? err.message : err));
      if (done) done(false);
    }
  }

  // The word that it worked, and the choice to adjust the player's name or
  // picture now that the account is settled.
  function showSignedIn(label, players) {
    const me = players[0] && P.findById(db, players[0].id || players[0].profileId) ? P.findById(db, players[0].id) : P.cloudProfiles(db)[0];
    const names = players.map((p) => p.name).join(', ');
    showCard(
      `<div class="logo"><span class="mini c2" style="font-size:30px">✅</span></div>
       <h2>Signed in with ${label}</h2>
       <p>${names ? `This device plays as <b>${esc(names)}</b>. ` : ''}Sign in with ${label} on another device and your games, rankings and players will be there too.</p>
       <div class="actions">
         ${me ? '<button class="btn big" id="signed-edit">Change my name or picture…</button>' : ''}
         <button class="btn big primary" id="signed-ok">Done</button>
       </div>`,
      true
    );
    $('#signed-ok').onclick = openOnline;
    if ($('#signed-edit')) $('#signed-edit').onclick = () => showProfile(me, openOnline);
  }

  // A sign-in the app remembers but the account no longer has (its stored
  // sign-in was lost, so this device started afresh) is forgotten, so that the
  // player is asked to sign in again instead of playing as nobody.
  async function checkLogin() {
    if (!settings.appleId || !C.configured()) return;
    try {
      await C.init();
    } catch (err) {
      return; // not connected: nothing can be said yet
    }
    if (C.signedInWith().includes('apple.com')) return;
    settings.appleId = null;
    saveSettings();
    reflectOnline();
  }

  // ---- Game Center (iPhone and iPad) ------------------------------------------------

  async function signInToGameCenter() {
    try {
      const gc = await window.rkGameCenter.signIn();
      if (!gc || !gc.alias) throw new Error('Game Center did not answer.');
      settings.gameCenter = { alias: String(gc.alias).slice(0, 40), id: String(gc.id || '').slice(0, 80) };
      saveSettings();
      reflectOnline();
      showCard(
        `<div class="logo"><span class="mini c3" style="font-size:30px">🎮</span></div>
         <h2>Logged in to Game Center</h2>
         <p>You are <b>${esc(settings.gameCenter.alias)}</b> on Game Center. Your online wins will show on its leaderboard too.</p>
         <div class="actions"><button class="btn big primary" id="gc-ok">OK</button></div>`,
        true
      );
      $('#gc-ok').onclick = openOnline;
      return;
    } catch (err) {
      toast(String(err && err.message ? err.message : err));
    }
    if (overlay.querySelector('.online-login')) showOnlineLogin();
    else if (overlay.querySelector('.online-home')) showOnlineHome();
  }

  // A remembered Game Center login is taken up again at every start, so that
  // the leaderboard keeps getting the wins. iOS shows its own sheet if the
  // player has to confirm.
  async function restoreGameCenter() {
    if (!window.rkGameCenter || !settings.gameCenter) return;
    try {
      const gc = await window.rkGameCenter.signIn();
      if (gc && gc.alias && gc.alias !== settings.gameCenter.alias) {
        settings.gameCenter = { alias: String(gc.alias).slice(0, 40), id: String(gc.id || '').slice(0, 80) };
        saveSettings();
      }
    } catch (err) {
      // declined or offline: the login stays until the player logs out
    }
  }

  // ---- logging out --------------------------------------------------------------------
  //
  // Ends every login. An account tied to an Apple ID is left behind with
  // everything it owns, and this device goes back to being a fresh, anonymous
  // one, so that whoever signs in next starts with their own account.

  async function logOut(wasPaused) {
    if (game && isOnline() && !game.over) return toast('Finish or leave your online game first.');
    if (lobby) return toast('Leave the lobby first.');
    const hadAccount = !!settings.appleId;
    settings.appleId = null;
    settings.gameCenter = null;
    settings.currentGame = null;
    saveSettings();
    if (online.stopFriends) online.stopFriends();
    if (online.stopInbox) online.stopInbox();
    if (stopMyGames) stopMyGames();
    online.stopFriends = online.stopInbox = stopMyGames = null;
    myGames.forEach((entry) => entry.stop && entry.stop());
    myGames.clear();
    inbox = [];
    shownInvite = null;
    online.friends = [];
    const wasOnline = online.ready;
    online.ready = false;
    online.rankings = null;
    online.clashes.clear();
    if (hadAccount) {
      await C.clearPushToken().catch(() => {});
      pushAsked = false;
      await C.signOut().catch(() => {});
      // the players belong to the account and come back with the next sign-in
      for (const p of db.profiles) p.cloud = false;
      saveDb();
    } else if (wasOnline) {
      await C.clearPresence().catch(() => {});
    }
    gameListChanged();
    reflectOnline();
    toast('Logged out.');
    closeCard(wasPaused);
  }

  // ---- the same players on several devices ---------------------------------------

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
    if (!online.ready || !mine.length) return toast('Go online first — register a player who plays online from this device.');
    if (lobby && lobby.host) {
      if (invitePid) inviteFriend(invitePid);
      return show ? showLobby() : undefined;
    }
    stopLobby();
    try {
      const name = L.defaultGameName(mine[0].name, myGames.size + 1);
      const gid = await C.createGame(myPerson(mine[0]), name);
      lobby = { gid, name, host: true, hostPerson: myPerson(mine[0]), seats: {}, invites: new Map(), meta: null, createdAt: C.serverNow(), stops: [], tick: 0 };
      for (let i = 0; i < Math.min(mine.length, 3); i++) {
        const seat = { ...myPerson(mine[i]), token: null, status: 'ready', at: 0 };
        await C.setSeat(gid, i, seat);
        lobby.seats[String(i)] = seat; // known before the database echoes it back
      }
      lobby.stops.push(C.watchSeats(gid, (seats) => lobby && lobby.gid === gid && ((lobby.seats = seats), refreshLobby())));
      lobby.stops.push(C.watchMeta(gid, (meta) => lobby && lobby.gid === gid && ((lobby.meta = meta), refreshLobby())));
      lobby.tick = setInterval(tickLobby, 1000);
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
  const onMac = /Mac|iPhone|iPad/.test(navigator.platform); // anything with Messages

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
    return { token, link, text: L.inviteMessage({ hostName: lobby.hostPerson.name, link, releasesUrl: RK.CLOUD.releasesUrl, gameName: lobby.name }) };
  }

  const MAIL_SUBJECT = "Join my game of Lynda's Rummi Time";
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
    showCard(
      `<h2>Invite a player</h2>
       <p>The invitation is written for you — choose who gets it in Messages or Mail, and press send.</p>
       <div class="actions">
         ${onMac ? '<button class="btn big primary" id="inv-sms">💬 iMessage</button>' : ''}
         <button class="btn big" id="inv-mail">✉️ Email</button>
         <button class="btn big" id="inv-copy">📋 Copy link</button>
       </div>
       <button class="link" id="inv-back">Back to the lobby</button>`,
      false
    );
    const sent = (kind) => async () => {
      await sendInvite(kind, '', inv);
      showLobby();
    };
    if ($('#inv-sms')) $('#inv-sms').onclick = sent('sms');
    $('#inv-mail').onclick = sent('mail');
    $('#inv-copy').onclick = sent('copy');
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
        const quick = () => showProfile({ name: '', face: FACE_CHOICES[db.profiles.length % FACE_CHOICES.length], cloud: true, quick: true }, (saved) => resolve(!!(saved && saved.cloud)));
        if (!db.profiles.length) return quick(); // the first time: just a name and a picture
        const rows = db.profiles.map((p) => `<button class="btn big" data-who="${p.id}">${avatarHtml(p)} ${esc(p.name)}</button>`).join('');
        showCard(
          `<h2>Who is playing online?</h2>
           <p>Friends will see this player when they are online, and can invite them.</p>
           <div class="join-choices">${rows}<button class="btn big primary" id="who-new">✨ New player…</button></div>
           <button class="link" id="who-link">🔗 I was sent an invitation link…</button>
           <button class="link" id="who-cancel">Not now</button>`,
          false
        );
        $('#who-link').onclick = () => resolve('link');
        overlay.querySelectorAll('[data-who]').forEach((b) => {
          b.onclick = () => {
            const p = P.findById(db, b.dataset.who);
            p.cloud = true;
            saveDb();
            resolve(true);
          };
        });
        $('#who-new').onclick = quick;
        $('#who-cancel').onclick = () => resolve(false);
      });
      if (chosen === 'link') {
        showPasteLink(showStart);
        return false;
      }
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

  // Redraws the lobby when something about it changed.
  const refreshLobby = () => {
    if (overlay.querySelector('.lobby')) showLobby();
  };

  // Once a second only the clocks are touched, never the whole card, so the
  // screen stays still and a button being pressed is not pulled away.
  function tickLobby() {
    if (!overlay.querySelector('.lobby')) return;
    const now = C.serverNow();
    overlay.querySelectorAll('.lobby [data-since]').forEach((el) => (el.textContent = L.fmtElapsed(now - +el.dataset.since)));
    overlay.querySelectorAll('.lobby [data-until]').forEach((el) => (el.textContent = L.fmtElapsed(+el.dataset.until - now)));
  }

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
        const since = e.invite ? e.invite.createdAt : now;
        let extra = '';
        if (status === 'later') extra = `<small>ready in <span data-until="${L.laterUntil(e.invite)}"></span> — start without them, or wait</small>`;
        const cls = { ready: 'online', declined: 'offline', expired: 'offline', removed: 'offline' }[status] || 'playing';
        return `<div class="online-row"><div class="avatar">${avatarHtml({ photo: e.photo, face: e.face })}</div>
          <div class="name">${esc(e.name)}${extra}</div>
          <span class="pill ${cls}">${L.statusText(status)}</span><span class="wait" data-since="${since}"></span>
          <button class="tool" data-uninvite="${e.token}" title="Withdraw the invitation">✕</button></div>`;
      })
      .join('');
    const friends = lobby.host
      ? L.friendsSummary(online.friends)
          .list.filter((f) => f.state === 'online' && ![...lobby.invites.values()].some((e) => e.toPid === f.pid) && !Object.values(seats).some((s) => s && s.pid === f.pid))
          .map((f) => `<button class="tool" data-invite="${f.pid}">${esc(f.name)}</button>`)
          .join(' ')
      : '';
    // recent players who cannot be invited right now, and when they last could
    const away = lobby.host
      ? L.friendsSummary(online.friends)
          .list.filter((f) => f.state !== 'online')
          .slice(0, 6)
          .map((f) => `<div class="online-row"><div class="avatar">${avatarHtml(f)}</div><div class="name">${esc(f.name)}</div><small>${esc(L.lastAvailableText(f.presence, now))}</small></div>`)
          .join('')
      : '';
    // invitations still open keep their seats: the game can start without
    // those players once the invitations are a couple of minutes old
    const pending = pendingInvites();
    const invites = pending.map((e) => e.invite || { createdAt: now });
    const ready = L.canStart(seats, invites, now);
    const since = lobby.meta && lobby.meta.createdAt ? lobby.meta.createdAt : lobby.createdAt;
    const title = lobby.host ? '' : (lobby.meta && lobby.meta.name) || `${lobby.hostName || 'The host'}'s game`;
    const html = `<div class="lobby"><h2>🎲 ${lobby.host ? 'Your online game' : esc(title)}</h2>
       ${lobby.host ? `<div class="game-name"><label>Name of this game <input id="lobby-name" maxlength="30" value="${esc(lobby.name)}"></label></div>` : ''}
       <div class="online-status">Waiting <span data-since="${since}"></span></div>
       ${pending.length && lobby.host ? `<p class="hint">You can start now: those still to join keep their seats and can come in later; the game waits for them at their turn.</p>` : ''}
       <h3>At the table</h3><div class="online-list">${seatRows || '<p class="hint">Nobody yet</p>'}</div>
       ${inviteRows ? `<h3>Invited</h3><div class="online-list">${inviteRows}</div>` : ''}
       ${
         lobby.host
           ? `<h3>Invite</h3><div class="invite-bar">${friends ? `<span>Friends online:</span> ${friends}` : '<span class="hint">No friends online to invite right now.</span>'}
              <button class="tool" id="inv-msg">✉️ Invite by iMessage or email…</button></div>
              ${away ? `<h3>Recent players</h3><div class="online-list recent">${away}</div>` : ''}`
           : '<p class="hint">The game starts when the host is ready.</p>'
       }
       <div class="actions">
         <button class="btn big" id="lobby-cancel">${lobby.host ? 'Cancel game' : 'Leave'}</button>
         ${lobby.host ? `<button class="btn big primary" id="lobby-start" ${ready ? '' : 'disabled'}>${pending.length ? 'Start now' : 'Start game'}</button>` : ''}
       </div></div>`;
    // an open lobby is updated in place; only opening it animates
    const open = overlay.querySelector('.lobby');
    if (open) open.parentElement.innerHTML = html;
    else showCard(html, false);
    tickLobby();
    $('#lobby-cancel').onclick = cancelLobby;
    if ($('#lobby-name')) {
      $('#lobby-name').onchange = () => {
        lobby.name = L.cleanGameName($('#lobby-name').value) || lobby.name;
        $('#lobby-name').value = lobby.name;
        C.nameGame(lobby.gid, lobby.name).catch(() => {});
      };
    }
    if ($('#lobby-start')) $('#lobby-start').onclick = startOnlineGame;

    if ($('#inv-msg')) $('#inv-msg').onclick = inviteByMessage;
    overlay.querySelectorAll('[data-invite]').forEach((b) => (b.onclick = () => inviteFriend(b.dataset.invite)));
    overlay.querySelectorAll('[data-uninvite]').forEach((b) => (b.onclick = () => removeInvite(b.dataset.uninvite)));
    overlay.querySelectorAll('[data-unseat]').forEach((b) => (b.onclick = () => C.removeSeat(lobby.gid, b.dataset.unseat).catch((err) => toast(err.message))));
  }

  // invitations that are still open: not answered, not seated yet
  function pendingInvites() {
    if (!lobby) return [];
    const now = C.serverNow();
    return [...lobby.invites.values()].filter((e) => {
      if (!e.invite) return true; // just sent, not echoed back yet
      const seat = lobby.seats[e.seat] && lobby.seats[e.seat].token === e.token ? lobby.seats[e.seat] : null;
      return ['sent', 'received', 'registering', 'joining', 'later'].includes(L.inviteStatus(e.invite, seat, now, RK.CLOUD.inviteTtlMs)) && !(seat && seat.status === 'ready');
    });
  }

  // The host deals and tells everyone; every computer then plays the opening.
  // Seats of people still to join are dealt too and wait for them.
  async function startOnlineGame() {
    const pending = pendingInvites();
    if (!lobby || !lobby.host || !L.canStart(lobby.seats, pending.map((e) => e.invite || { createdAt: C.serverNow() }), C.serverNow())) return;
    const bySeat = {};
    Object.keys(lobby.seats).forEach((n) => lobby.seats[n] && (bySeat[n] = lobby.seats[n]));
    for (const e of pending) {
      const friend = e.toPid ? online.friends.find((f) => f.pid === e.toPid) || { pid: e.toPid, name: e.name, face: e.face } : null;
      bySeat[e.seat] = { ...L.absentPerson({ token: e.token, game: lobby.gid }, e.seat, friend), token: e.token, status: 'absent', at: 0 };
    }
    const seats = Object.keys(bySeat)
      .sort()
      .map((n) => bySeat[n]);
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
        name: lobby.name,
      });
    } catch (err) {
      return toast('Could not start the game: ' + err.message);
    }
    const meta = { host: lobby.hostPerson.pid, hostDevice: C.deviceId(), name: lobby.name, startedAt: C.serverNow(), phase: 'playing', players: seats, start: { draws: draws.map((t) => t.id), current: g.current } };
    // invitations of those who joined have done their job; the others stay open so that their players can still come in
    const keep = new Set(pending.map((e) => e.token));
    for (const token of lobby.invites.keys()) if (!keep.has(token)) C.deleteInvite(token);
    C.addMyGame(gid, { name: lobby.name, host: true });
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
          C.addMyGame(gid, { name: meta.name, host: false });
          joinStartedGame(gid, meta);
        }
        else if (!meta) {
          stopLobby();
          toast('The host cancelled the game.');
          showStart();
        } else refreshLobby();
      })
    );
    lobby.tick = setInterval(tickLobby, 1000);
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
      name: meta.name || '',
      players: meta.players.map((s) => {
        const local = s.device === uid;
        const prof = local ? P.findById(db, s.pid) : null;
        return { name: s.name, isAI: false, face: s.face, photo: prof ? prof.photo : null, profileId: s.pid, device: s.device, remote: !local, absent: L.isAbsent(s) };
      }),
    };
    game = g;
    applyMetaNames();
    view = null;
    busy = true;
    thinking = -1;
    statusOverride = '';
    buildPlayers();
    buildTiles();
    // everyone at the table becomes friends
    const mine = config.players.filter((p) => !p.remote);
    for (const me of mine) for (const other of config.players) if (other.remote && !other.absent) C.addFriend(me.profileId, other.profileId, { name: other.name, face: other.face }).catch(() => {});
    C.setPresence(P.cloudProfiles(db).map((p) => p.id), g.id).catch(() => {});
    settings.currentGame = g.id;
    if (meta.hostDevice === uid && !settings.hostedGames.includes(g.id)) settings.hostedGames = settings.hostedGames.concat(g.id).slice(-20);
    saveSettings();
    $('#status-game').textContent = config.name;
    watchOnlineGame(g.id, appliedRev);
    startChat(g.id);
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

  // The game's players as the database knows them now: someone who joined
  // after the start takes over the seat's name and picture everywhere.
  function applyMetaNames() {
    if (!game || !config || !config.online) return;
    config.players.forEach((cp, i) => {
      if (game.players[i]) {
        game.players[i].name = cp.name;
        game.players[i].profileId = cp.profileId;
      }
    });
  }

  function takeMeta(meta) {
    if (!meta || !isOnline() || !game || meta.players.length !== config.players.length) return;
    const uid = C.deviceId();
    let changed = false;
    meta.players.forEach((s, i) => {
      const cp = config.players[i];
      if (cp.device === s.device && cp.name === s.name && cp.profileId === s.pid) return;
      const local = s.device === uid;
      const prof = local ? P.findById(db, s.pid) : null;
      Object.assign(cp, { name: s.name, face: s.face, photo: prof ? prof.photo : cp.photo, profileId: s.pid, device: s.device, remote: !local, absent: L.isAbsent(s) });
      changed = true;
      if (!local && !cp.absent) C.readPlayer(s.pid).then((rec) => rec && rec.photo && ((cp.photo = rec.photo), buildPlayers(), render()));
    });
    if (!changed) return;
    applyMetaNames();
    buildPlayers();
    render();
    watchPresenceOfTable();
    if (config.players[game.current].remote) waitTick();
  }

  function watchPresenceOfTable() {
    if (sync.stopPresence) sync.stopPresence();
    const remote = config.players.filter((p) => p.remote && !p.absent).map((p) => p.profileId);
    sync.stopPresence = C.watchPresenceOf(remote, (map) => {
      sync.presence = map;
      if (game && !game.over && config.players[game.current].remote) waitTick();
    });
  }

  function watchOnlineGame(gid, appliedRev = 0) {
    stopOnlineGame(false);
    sync.rev = appliedRev;
    sync.stopMeta = C.watchMeta(gid, (meta) => {
      if (!game || game.id !== gid || !isOnline()) return;
      if (!meta) {
        stopOnlineGame(true);
        toast('The host ended this game.');
        return showStart();
      }
      takeMeta(meta);
    });
    sync.stopState = C.watchState(gid, (state) => {
      if (!state || !isOnline() || !game || game.id !== gid) return;
      if (!SY.acceptRev(sync.rev, state.rev)) return;
      sync.rev = state.rev;
      if (state.sid === C.sessionId()) return; // our own publish coming back
      applyRemote(state);
    });
    watchPresenceOfTable();
  }

  // leaving = true when this computer is done with the game for good
  function stopOnlineGame(leaving = true) {
    stopWaiting();
    if (sync.stopState) sync.stopState();
    if (sync.stopPresence) sync.stopPresence();
    if (sync.stopMeta) sync.stopMeta();
    sync.stopState = sync.stopPresence = sync.stopMeta = null;
    if (!leaving) return;
    stopChat();
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
    applyMetaNames();
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
    if (action && action.place === 1 && !game.over) await showWinner(action.player);
    else await sleep(action && action.place ? 3200 : action && action.type === 'play' ? 2400 : 900);
    if (token !== turnToken) return;
    runTurn();
  }

  // While a remote player is up: show how long they have been away and, once
  // they have been offline long enough, let the right computer skip them.
  function waitTick() {
    if (!isOnline() || !game || game.over || !config.players[game.current].remote) return stopWaiting();
    const p = config.players[game.current];
    if (p.absent) {
      // invited, not here yet: the game waits for them, however long it takes
      const until = L.expiresAt(metaOf(game.id));
      statusOverride = `Waiting for ${p.name} to join${until ? ` — the game ends in ${L.fmtAgo(until - C.serverNow()).replace(' ago', '')} if they do not` : ''}`;
      $('#status-text').textContent = statusOverride;
      $('#btn-skip').hidden = true;
      if (!sync.tick) sync.tick = setInterval(waitTick, 15000);
      return;
    }
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

  // ---- several games at once ----
  //
  // Every online game this device has a seat in is watched all the time, so
  // that a turn coming up in another game can be announced, and so the list
  // of games is always current. A local game is parked while an online one is
  // open and can be picked up again from the same list.

  const myGames = new Map(); // gid → { meta, state, stop, alerted }
  let stopMyGames = null;
  const metaOf = (gid) => (myGames.get(gid) || {}).meta || null;

  function watchMyGames() {
    if (stopMyGames) stopMyGames();
    stopMyGames = C.watchMyGames((gids) => {
      for (const [gid, entry] of myGames) {
        if (gids.includes(gid)) continue;
        entry.stop();
        myGames.delete(gid);
      }
      for (const gid of gids) {
        if (myGames.has(gid)) continue;
        const entry = { meta: null, state: null, stop: null, alerted: 0, seen: false };
        const offMeta = C.watchMeta(gid, (meta) => ((entry.meta = meta), (entry.seen = true), gameListChanged(gid)));
        const offState = C.watchState(gid, (state) => ((entry.state = state), gameListChanged(gid)));
        entry.stop = () => (offMeta(), offState());
        myGames.set(gid, entry);
      }
      gameListChanged();
    });
  }

  // A game's turn, from its published record, without unpacking the whole game.
  function briefOf(gid) {
    const e = myGames.get(gid);
    if (!e || !e.meta) return null;
    const uid = C.deviceId();
    let current = e.state ? e.state.current : e.meta.start ? e.meta.start.current : 0;
    let over = e.meta.phase === 'over';
    let turns = 0;
    let lastAt = e.state ? e.state.at : e.meta.startedAt;
    if (e.state) {
      try {
        const raw = JSON.parse(e.state.json);
        over = over || raw.over === true;
        turns = Array.isArray(raw.history) ? raw.history.length : 0;
        current = Number.isInteger(raw.current) ? raw.current : current;
      } catch (err) {
        // a record this version cannot read: shown without detail
      }
    }
    const expires = L.expiresAt(e.meta);
    const expired = !!expires && C.serverNow() > expires;
    const mover = e.meta.players[current] || null;
    return {
      gid,
      name: e.meta.name || `${(e.meta.players[0] || {}).name || 'A'}'s game`,
      meta: e.meta,
      players: e.meta.players,
      current,
      mover,
      mine: !!mover && mover.device === uid,
      host: e.meta.hostDevice === uid,
      over: over || expired,
      expired,
      expires,
      turns,
      lastAt,
      rev: e.state ? e.state.rev : 0,
    };
  }

  function gameListChanged(gid) {
    if (gid) announceTurn(gid);
    const open = game && isOnline() ? game.id : null;
    const due = [...myGames.keys()].map(briefOf).filter((b) => b && b.mine && !b.over && b.gid !== open).length;
    $('#games-count').textContent = due || '';
    $('#btn-games').hidden = !myGames.size && !settings.parked;
    reflectSwitch();
    if (overlay.querySelector('.games-list')) renderGamesList();
    if ($('#start-games')) $('#start-games').innerHTML = gamesListHtml(true);
    tidyMyGames();
  }

  // Your turn in a game that is not on screen: a banner and a sound, once per turn.
  function announceTurn(gid) {
    const b = briefOf(gid);
    if (!b || !b.mine || b.over || (game && isOnline() && game.id === gid)) return;
    const e = myGames.get(gid);
    if (e.alerted === b.rev) return;
    e.alerted = b.rev;
    $('#turn-alert-text').textContent = `Your turn in “${b.name}”`;
    $('#turn-alert').hidden = false;
    $('#turn-alert').dataset.gid = gid;
    chatDing(false);
    notify(`Your turn in “${b.name}”`, () => openGame(gid));
  }
  $('#turn-alert-open').addEventListener('click', () => {
    const gid = $('#turn-alert').dataset.gid;
    $('#turn-alert').hidden = true;
    if (gid) openGame(gid);
  });
  $('#turn-alert-close').addEventListener('click', () => ($('#turn-alert').hidden = true));

  // A notification from the system, for when the game is not the window in
  // front. Where the system has none to offer (or was not allowed), the
  // banner inside the game is all there is.
  function notify(text, onClick) {
    try {
      if (!window.Notification || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
      const n = new Notification("Lynda's Rummi Time", { body: text, silent: true });
      n.onclick = () => {
        window.focus();
        onClick();
      };
    } catch (err) {
      // no notifications here
    }
  }

  // One tap between the two kinds of game: in a game against the computer
  // the button leads to the online game (the one waiting for you first), and
  // in an online game it leads back to the single-player game.
  function reflectSwitch() {
    const btn = $('#btn-switch');
    const inGame = game && !game.over;
    const open = inGame && isOnline() ? game.id : null;
    const others = [...myGames.keys()].map(briefOf).filter((b) => b && !b.over && b.gid !== open);
    let label = '';
    let go = null;
    if (inGame && !isOnline() && others.length) {
      const due = others.filter((b) => b.mine);
      const pick = due[0] || others.sort((a, b) => b.lastAt - a.lastAt)[0];
      label = others.length > 1 && due.length !== 1 ? `🌐 Online games${due.length ? ' · ' + due.length + ' waiting' : ''}` : `🌐 ${pick.name}${pick.mine ? ' · your turn' : ''}`;
      go = others.length > 1 && due.length !== 1 ? showGames : () => openGame(pick.gid);
      btn.classList.toggle('due', due.length > 0);
    } else if (inGame && isOnline()) {
      label = settings.parked ? '🧑‍💻 Back to single player' : '🧑‍💻 Single player';
      go = settings.parked
        ? resumeParked
        : () => {
            setup.mode = 'single';
            showSetup();
          };
      btn.classList.remove('due');
    }
    btn.hidden = !go;
    btn.textContent = label;
    btn.onclick = go;
  }

  function gamesListHtml(short) {
    const uid = C.deviceId();
    const open = game && isOnline() ? game.id : null;
    const briefs = [...myGames.keys()]
      .map(briefOf)
      .filter(Boolean)
      .sort((a, b) => b.mine - a.mine || a.over - b.over || b.lastAt - a.lastAt);
    const rows = briefs.map((b) => {
      const faces = b.players.map((p) => `<span class="avatar" title="${esc(p.name)}">${esc(p.face)}</span>`).join('');
      let status;
      if (b.expired) status = '<span class="pill offline">Ended — someone never joined</span>';
      else if (b.over) status = '<span class="pill offline">Over</span>';
      else if (b.gid === open) status = '<span class="pill online">Open now</span>';
      else if (b.mine) status = '<span class="pill playing">Your turn</span>';
      else if (b.mover && L.isAbsent(b.mover)) status = `<span class="pill offline">Waiting for ${esc(b.mover.name)} to join</span>`;
      else status = `<span class="pill offline">${esc(b.mover ? b.mover.name : '?')}'s turn</span>`;
      const who = b.players.map((p) => (p.device === uid ? 'you' : p.name)).join(', ');
      return `<div class="online-row game-row${b.mine && !b.over ? ' due' : ''}">
        <div class="faces">${faces}</div>
        <div class="name">${esc(b.name)}<small>${esc(who)} · ${b.turns} turn${b.turns === 1 ? '' : 's'} · ${L.fmtAgo(C.serverNow() - b.lastAt)}</small></div>
        ${status}
        ${b.gid !== open && !b.over ? `<button class="btn ${b.mine ? 'primary' : ''}" data-open-game="${b.gid}">Open</button>` : ''}
        ${b.host ? `<button class="tool" data-end-game="${b.gid}" title="${b.over ? 'Remove' : 'End this game for everyone'}">✕</button>` : b.over ? `<button class="tool" data-leave-game="${b.gid}" title="Remove">✕</button>` : ''}
      </div>`;
    });
    if (settings.parked) {
      const pk = settings.parked;
      rows.unshift(`<div class="online-row game-row"><div class="faces">${pk.players.map((p) => `<span class="avatar">${esc(p.face || '🤖')}</span>`).join('')}</div>
        <div class="name">Single player game<small>${esc(pk.players.map((p) => p.name).join(', '))} · paused ${L.fmtAgo(Date.now() - pk.savedAt)}</small></div>
        <span class="pill playing">Paused</span><button class="btn" id="resume-parked">Resume</button><button class="tool" id="drop-parked" title="Abandon">✕</button></div>`);
    }
    if (!rows.length) return short ? '' : '<p class="hint">No games going on. Start one, or wait for an invitation.</p>';
    return `<div class="online-list games-list">${rows.join('')}</div>`;
  }

  function bindGamesList(root) {
    root.querySelectorAll('[data-open-game]').forEach((b) => (b.onclick = () => openGame(b.dataset.openGame)));
    root.querySelectorAll('[data-end-game]').forEach((b) => (b.onclick = () => endGameForAll(b.dataset.endGame, b)));
    root.querySelectorAll('[data-leave-game]').forEach((b) => (b.onclick = () => C.removeMyGame(b.dataset.leaveGame)));
    if (root.querySelector('#resume-parked')) root.querySelector('#resume-parked').onclick = resumeParked;
    if (root.querySelector('#drop-parked')) root.querySelector('#drop-parked').onclick = () => ((settings.parked = null), saveSettings(), gameListChanged());
  }

  function renderGamesList() {
    const box = overlay.querySelector('.games-box');
    if (!box) return;
    box.innerHTML = gamesListHtml(false);
    bindGamesList(box);
  }

  function showGames() {
    const wasPaused = paused;
    if (game && !game.over) paused = true;
    showCard(`<div class="online-home"><h2>🎲 Your games</h2><div class="games-box">${gamesListHtml(false)}</div>
      <div class="actions"><button class="btn big primary" id="games-close">Close</button></div></div>`, true);
    $('#games-close').onclick = () => closeCard(wasPaused);
    bindGamesList(overlay);
  }
  $('#btn-games').addEventListener('click', showGames);

  async function endGameForAll(gid, btn) {
    const b = briefOf(gid);
    // ending a game that is still going takes a second press
    if (b && !b.over && btn && btn.dataset.sure !== 'yes') {
      btn.dataset.sure = 'yes';
      btn.textContent = 'End for everyone?';
      setTimeout(() => btn.isConnected && ((btn.dataset.sure = ''), (btn.textContent = '✕')), 4000);
      return;
    }
    await C.deleteGame(gid);
    await C.removeMyGame(gid);
    if (game && isOnline() && game.id === gid) {
      stopOnlineGame(true);
      showStart();
    }
  }

  // A local game steps aside for an online one and waits in the games list.
  function parkLocalGame() {
    if (!game || game.over || isOnline()) return;
    turnToken++;
    settings.parked = { json: JSON.stringify(game), players: config.players.map((p) => ({ name: p.name, face: p.face, isAI: p.isAI, level: p.level, profileId: p.profileId })), savedAt: Date.now() };
    saveSettings();
  }

  function resumeParked() {
    const pk = settings.parked;
    if (!pk) return;
    let loaded;
    try {
      loaded = Game.fromJSON(JSON.parse(pk.json));
    } catch (err) {
      settings.parked = null;
      saveSettings();
      return toast('The paused game could not be read.');
    }
    if (isOnline()) {
      stopOnlineGame(false);
      stopChat();
    }
    settings.parked = null;
    saveSettings();
    $('#status-game').textContent = '';
    resumeGame(loaded, pk.players.map((p) => p.face), 'your single player game');
    gameListChanged();
  }

  // Switch to one of the online games: the table as it is now, with a word
  // about who is in it and what happened last.
  async function openGame(gid) {
    if (!online.ready) return toast('Not connected.');
    if (game && isOnline() && game.id === gid) return hideOverlay();
    const meta = await C.readMeta(gid);
    const state = meta ? await C.readState(gid).catch(() => null) : null;
    if (!meta || !state) return toast('That game is no longer there.');
    let g;
    try {
      g = SY.unpackState(state);
    } catch (err) {
      return toast('The game could not be read: ' + err.message);
    }
    if (game && !game.over && !isOnline()) parkLocalGame();
    if (isOnline()) stopOnlineGame(false);
    hideOverlay();
    enterOnlineGame(meta, g, state.rev);
    if (humans() === 1) view = config.players.findIndex((p) => !p.remote);
    renderInstant();
    $('#turn-alert').hidden = true;
    gameListChanged();
    showGameSummary(() => runTurn());
  }

  function showGameSummary(done) {
    const b = briefOf(game.id) || { name: config.name };
    const uid = C.deviceId();
    const rows = config.players
      .map((p, i) => `<div class="online-row"><div class="avatar">${avatarHtml(p)}</div><div class="name">${esc(p.name)}${p.device === uid ? ' <small>you</small>' : ''}</div>
          <span class="pill ${i === game.current ? 'playing' : 'offline'}">${i === game.current ? 'To play' : game.rackTiles(game.players[i]).length + ' tiles'}</span></div>`)
      .join('');
    const recent = game.history
      .slice(-4)
      .reverse()
      .map((h) => `<li>${esc(describe({ player: h.player, type: h.type, count: h.count, place: h.place }))}</li>`)
      .join('');
    showCard(
      `<h2>🎲 ${esc(b.name || 'Online game')}</h2>
       <h3>Players</h3><div class="online-list">${rows}</div>
       ${recent ? `<h3>Recent moves</h3><ul class="recent-moves">${recent}</ul>` : '<p class="hint">Nobody has moved yet.</p>'}
       <div class="actions"><button class="btn big primary" id="summary-go">${config.players[game.current].device === uid ? 'Play your turn' : 'Watch'}</button></div>`,
      true
    );
    $('#summary-go').onclick = () => {
      hideOverlay();
      done();
    };
  }

  // A finished online game goes into this device's statistics and into the
  // rankings of its own players. Safe to call again for the same game.
  function recordOnlineResult(g, persons) {
    if (!g.over || !g.result || db.games.some((x) => x.id === g.id)) return;
    const uid = C.deviceId();
    persons.forEach((s, i) => {
      const prof = s.device === uid && s.pid ? P.findById(db, s.pid) : null;
      if (prof && prof.cloud) C.addResult(prof, g.result.winner === i, g.id);
    });
    online.rankings = null;
    if (P.recordGame(db, g, Date.now(), true)) saveDb();
    reportToGameCenter(persons.filter((s) => s.device === uid).map((s) => s.pid));
  }

  // Game Center keeps one score per Apple ID: the online wins of this
  // device's players (the most, if several play here).
  const GC_LEADERBOARD = 'online_wins';
  async function reportToGameCenter(pids) {
    if (!window.rkGameCenter || !settings.gameCenter || !pids.length) return;
    try {
      await new Promise((r) => setTimeout(r, 1500)); // the rankings transaction lands first
      const standings = await Promise.all(pids.map((pid) => C.readRanking(pid)));
      const wins = Math.max(0, ...standings.filter(Boolean).map((r) => r.wins));
      if (wins > 0) await window.rkGameCenter.report(GC_LEADERBOARD, wins);
    } catch (err) {
      // the leaderboard is a bonus; the game's own rankings stand regardless
    }
  }

  const KEEP_FINISHED_MS = 7 * 24 * 60 * 60 * 1000;

  // Games that are over or past their time are dropped from the list; the
  // host removes them from the database.
  let tidying = false;
  async function tidyMyGames() {
    if (tidying || !online.ready) return;
    tidying = true;
    try {
      for (const gid of [...myGames.keys()]) {
        const e = myGames.get(gid);
        if (e && e.seen && !e.meta) {
          await C.removeMyGame(gid); // the host removed it
          continue;
        }
        const b = briefOf(gid);
        if (!b) continue;
        const stale = b.over || (b.meta.phase === 'lobby' && C.serverNow() - b.meta.createdAt > RK.CLOUD.inviteTtlMs);
        if (!stale || (game && isOnline() && game.id === gid && !game.over)) continue;
        // a game that ended while nobody here was looking still counts
        if (b.over && !b.expired && e.state) {
          try {
            recordOnlineResult(SY.unpackState(e.state), b.players);
          } catch (err) {
            // a record this version cannot read is left uncounted
          }
        }
        // the host keeps a finished game for a week so the others can see how it ended
        if (b.host && b.over && !b.expired && C.serverNow() - b.lastAt < KEEP_FINISHED_MS) continue;
        if (b.host) await C.deleteGame(gid);
        await C.removeMyGame(gid);
      }
    } finally {
      tidying = false;
    }
  }

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
      const expires = L.expiresAt(meta);
      if (meta && (meta.phase === 'over' || myGames.has(gid))) continue; // tidyMyGames looks after these
      if (meta && meta.phase === 'playing' && !(expires && C.serverNow() > expires)) keep.push(gid);
      else if (meta) await C.deleteGame(gid);
    }
    if (keep.length !== settings.hostedGames.length) {
      settings.hostedGames = keep;
      saveSettings();
    }
  }

  // ---- chat during an online game ----

  const chat = { stop: null, seen: new Set(), opened: 0 };

  function startChat(gid) {
    stopChat();
    $('#chat').hidden = false;
    $('#chat-list').innerHTML = '<div class="empty">Say hello — everyone at the table sees it.</div>';
    chat.opened = Date.now();
    chat.stop = C.watchChat(gid, (msg) => {
      if (chat.seen.has(msg.id)) return;
      chat.seen.add(msg.id);
      const list = $('#chat-list');
      const empty = list.querySelector('.empty');
      if (empty) empty.remove();
      const mine = msg.device === C.deviceId();
      const who = config.players.find((p) => p.profileId === msg.pid);
      const row = document.createElement('div');
      row.className = 'chat-msg' + (mine ? ' mine' : '');
      row.innerHTML = `<span class="avatar">${who ? avatarHtml(who) : '🙂'}</span><div><b>${esc(msg.name)}</b><small>${clock(msg.at)}</small><p>${esc(msg.text)}</p></div>`;
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
      // a softer ding for messages from others; none for the backlog on (re)joining
      if (!mine && Date.now() - chat.opened > 1500) {
        chatDing(false);
        // a closed chat counts what has not been read
        if ($('#chat').classList.contains('closed') && !document.body.classList.contains('drawers')) $('#chat-unread').textContent = (+$('#chat-unread').textContent || 0) + 1;
      }
    });
    renderInstant();
  }

  function stopChat() {
    if (chat.stop) chat.stop();
    chat.stop = null;
    chat.seen = new Set();
    $('#chat').hidden = true;
  }

  // sending rings brightly, receiving a little lower and softer
  function chatDing(sent) {
    if (sent) {
      tone(1320, 1320, 0.12, 0.13, 0, 'sine');
      tone(1760, 1760, 0.22, 0.11, 0.09, 'sine');
    } else {
      tone(880, 880, 0.14, 0.1, 0, 'sine');
      tone(1175, 1175, 0.22, 0.08, 0.1, 'sine');
    }
  }

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !isOnline() || !game) return;
    // on a shared computer the message comes from whoever's rack is showing
    const seat = view !== null && !config.players[view].remote ? view : config.players.findIndex((p) => !p.remote);
    const me = config.players[seat];
    input.value = '';
    try {
      await C.sendChat(game.id, { pid: me.profileId, name: me.name, text });
      chatDing(true);
    } catch (err) {
      input.value = text;
    }
  });

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
       <p>Lynda's Rummi Time, online, right now.</p>
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
    const meta = await C.readMeta(inv.game);
    if (meta && meta.phase === 'playing') return joinLate(inv, meta, me);
    if (game && !game.over && !isOnline()) parkLocalGame();
    guestLobby(inv.game, inv.seat, inv.from.name);
  }

  // The game started without this player: take the seat that was kept.
  async function joinLate(inv, meta, me) {
    try {
      await C.admitSelf(inv.game, inv.seat, myPerson(me));
      await C.addMyGame(inv.game, { name: meta.name, host: false });
    } catch (err) {
      return toast('Could not join the game: ' + err.message);
    }
    toast(`You are in “${meta.name || inv.from.name + "'s game"}”.`);
    openGame(inv.game);
  }

  // For a link that did not open the game by itself: paste it here.
  function showPasteLink(back) {
    showCard(
      `<h2>🔗 Join with an invitation link</h2>
       <p>Tapping the link in Messages or Mail normally opens the game by itself. If it did not, copy the link and paste it here.</p>
       <div class="paste-link"><input id="paste-link" placeholder="rummi-tummi://join?t=…" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
       <div class="actions"><button class="btn big" id="paste-back">Back</button><button class="btn big primary" id="paste-join">Join</button></div>`,
      false,
      'pf'
    );
    const go = () => handleUrl($('#paste-link').value);
    $('#paste-join').onclick = go;
    $('#paste-link').addEventListener('keydown', (e) => e.key === 'Enter' && go());
    $('#paste-back').onclick = back;
  }

  // An invitation link: opened from Messages or Mail, or pasted in.
  async function handleUrl(url) {
    if (L.parseAuthUrl(url, RK.CLOUD.scheme)) return handleAuthUrl(url);
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


  $('#btn-online').addEventListener('click', openOnline);

  // ---- compact layout: the menu and the drawers ----------------------------

  $('#btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#tools').classList.toggle('open');
  });
  // choosing something from the menu, or tapping elsewhere, closes it
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-more') && !e.target.closest('.speed')) $('#tools').classList.remove('open');
  });
  const drawer = (id, other) => () => {
    $(other).classList.remove('drawer-open');
    $(id).classList.toggle('drawer-open');
  };
  $('#btn-log').addEventListener('click', drawer('#log', '#chat'));
  $('#btn-chat').addEventListener('click', drawer('#chat', '#log'));
  // a tap on the table puts the drawers away
  $('#stage').addEventListener('pointerdown', () => {
    $('#log').classList.remove('drawer-open');
    $('#chat').classList.remove('drawer-open');
    if (activeTile !== null) {
      activeTile = null;
      if (game) renderInstant();
    }
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
         <div class="setting"><div class="label">Move assist — what to tell me at the start of my turn${isOnline() ? ' (not available in an online game)' : ''}</div>
           <select class="set-assist" ${isOnline() ? 'disabled' : ''}>${assist}</select></div>
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
    `<div class="owner">Lynda's</div><div class="logo">${'RUMMI TIME'
      .split('')
      .map((c, i) => (c === ' ' ? '<span class="logo-gap"></span>' : `<span class="mini c${i % 4}" style="animation-delay:${i * 60}ms">${c}</span>`))
      .join('')}</div>`;

  // The opening curtain: the name and a promise, for a moment or until tapped.
  function showSplash() {
    const el = document.createElement('div');
    el.id = 'splash';
    el.innerHTML = `<div>${logoHtml()}<p class="promise">Ad free forever</p></div>`;
    document.body.appendChild(el);
    const close = () => {
      el.classList.add('gone');
      setTimeout(() => el.remove(), 600);
    };
    el.addEventListener('pointerdown', close);
    setTimeout(close, 2600);
  }

  let home = 'start'; // which opening screen a closed dialog returns to
  const showHome = () => (home === 'setup' ? showSetup() : showStart());

  // The first screen: what kind of game, or an invitation straight away.
  function showStart() {
    resetToHome();
    home = 'start';
    showCard(
      `
      ${logoHtml()}
      <div class="modes">
        <button class="mode" data-mode="single"><span class="icon">🧑‍💻</span><b>Single player</b><small>You against the computer</small></button>
        <button class="mode" data-mode="local"><span class="icon">👥</span><b>Same computer</b><small>2 to 4 people take turns here</small></button>
        <button class="mode" data-mode="online"><span class="icon">🌐</span><b>Online</b><small id="start-friends"></small></button>
      </div>
      <div id="start-games">${online.ready ? gamesListHtml(true) : ''}</div>
      <div class="start-links">
        <button class="link" id="load-saved">📂 Load a saved game…</button>
        <button class="link" id="open-roster">👥 Players and statistics…</button>
        <button class="link" id="open-settings">⚙ Settings…</button>
        <button class="link" id="watch">🤖 Watch the computer play…</button>
      </div>
      <div class="version" id="app-version"></div>
    `,
      false,
      'wide'
    );
    bindGamesList(overlay);
    if (window.rkCloud && window.rkCloud.version) {
      window.rkCloud.version().then((v) => {
        if ($('#app-version')) $('#app-version').textContent = 'Version ' + v;
      });
    }
    overlay.querySelectorAll('.mode').forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.mode === 'online') return openOnline();
        setup.mode = b.dataset.mode;
        showSetup();
      };
    });
    $('#watch').onclick = () => {
      setup.mode = 'watch';
      showSetup();
    };
    $('#load-saved').addEventListener('click', loadGame);
    $('#open-roster').addEventListener('click', showRoster);
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
      <p class="odds">Chance of making your first ${FIRST_MELD_POINTS}-point meld: <b>${FIRST_MELD_ODDS[0]}%</b> on your first turn, <b>${FIRST_MELD_ODDS[1]}%</b> by your second, <b>${FIRST_MELD_ODDS[2]}%</b> by your third.</p>
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
        return `<div class="ai-row"><span class="who">🤖 <span class="who-word">Computer </span>${i + 1}</span><div class="levels">${buttons}</div></div>`;
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
          <div class="left">${statsHtml(p.id)}${p.handle ? `<small class="handle">📨 ${esc(p.handle)}</small>` : ''}</div>
          <button class="tool" data-edit="${p.id}">Edit</button>
        </div>`
      )
      .join('');
    showCard(
      `<h2>Registered players</h2>
       <p>Statistics are kept for everyone registered here, from the games finished on this device. Offline games (against the computer, or several people on one device) and online games are counted apart.</p>
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
      name: start.name || (!start.id && settings.gameCenter ? settings.gameCenter.alias.slice(0, 12) : ''),
      face: start.face || '😀',
      photo: start.photo || null,
      handle: start.handle || '',
      cloud: start.cloud === true,
      quick: start.quick === true, // the first online player: a name and a picture, nothing else
    };
    const existing = !!draft.id;
    showCard(
      `<h2>${existing ? 'Edit player' : draft.quick ? 'Create your player' : 'Register a player'}</h2>
       ${draft.quick ? '<p>Pick a name nobody else is using, and a picture — or take a photo.</p>' : ''}
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
           ${
             draft.quick
               ? ''
               : `<label>iMessage phone or email <small>optional — so this player can be invited to games in a later version</small>
             <input id="pf-handle" maxlength="100" value="${esc(draft.handle)}" placeholder="+1 555 010 2030 or name@example.com"></label>
           <label class="opt cloud-opt"><input type="checkbox" id="pf-cloud" ${draft.cloud ? 'checked' : ''}> Plays online from this device
             <small>${C.configured() ? 'Friends will see when this player is online and can invite them' : 'Online play is not set up yet — see docs/online.md'}</small></label>`
           }
           <div class="label">Picture to use when there is no photo</div>
           <div class="face-grid">${FACE_CHOICES.map((f) => `<button type="button" data-f="${f}">${f}</button>`).join('')}</div>
           ${existing ? `<div class="pf-stats">${statsHtml(draft.id)}</div>` : ''}
         </div>
       </div>
       <p class="hint" id="pf-error"></p>
       <div class="actions">
         ${existing ? '<button class="btn big danger" id="pf-delete">Delete</button>' : ''}
         <button class="btn big" id="pf-cancel">Cancel</button>
         <button class="btn big primary" id="pf-save">${existing ? 'Save' : draft.quick ? "Let's play" : 'Register'}</button>
       </div>`,
      false,
      'pf'
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
    $('#pf-save').onclick = async () => {
      try {
        const before = draft.id ? P.findById(db, draft.id) : null;
        const wasCloud = before ? before.cloud : false;
        const oldName = before ? before.name : '';
        const name = $('#pf-name').value;
        const cloud = draft.quick ? true : $('#pf-cloud').checked;
        if (P.isOffensive(name)) throw new Error('Please choose a friendlier name.');
        // online, a name can belong to one player only
        if (cloud && C.configured() && name.trim()) {
          $('#pf-save').disabled = true;
          const owner = await C.nameOwner(name).catch(() => null);
          $('#pf-save').disabled = false;
          if (owner && owner !== draft.id) throw new Error(`“${name.trim()}” is already taken by another online player. Try another name.`);
        }
        const saved = P.saveProfile(db, { ...draft, name, handle: draft.quick ? '' : $('#pf-handle').value, cloud });
        saveDb();
        online.clashes.delete(saved.id);
        if (wasCloud && (!saved.cloud || L.nameKey(oldName) !== L.nameKey(saved.name))) await C.releaseName(oldName, saved.id).catch(() => {});
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
        if (draft.cloud) C.releaseName(draft.name, draft.id).catch(() => {}).then(() => C.removePlayer(draft.id).catch(() => {}));
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
    autoSort.clear();
    lastSort.clear();
    activeTile = null;
    if (isOnline()) {
      stopOnlineGame(false);
      stopChat();
    }
    $('#status-game').textContent = '';
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
      recordOnlineResult(game, config.players.map((cp) => ({ pid: cp.profileId, device: cp.device })));
      stopOnlineGame(true);
      C.endGame(gid); // only the host's computer is allowed to; others are refused quietly
      // the finished game stays in the database for a week, so that every
      // player's device gets to see the result; tidyMyGames removes it then
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
              <div class="left">${left.length ? left.map((t) => miniTile(t, true)).join('') : `Went out ${ordinal(p.place)}`}${p.profileId && P.findById(db, p.profileId) ? `<small class="handle">📊 ${statsHtml(p.profileId)}</small>` : ''}</div>
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
    confetti(overlay);
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
    createMessageInvite,
    openGame,
    showGames,
    get lobby() {
      return lobby;
    },
    celebrate: () => scrabalicious({ player: 0, count: 8 }),
    showWinner,
  };

  // On a phone the keyboard pushes the page up; put it back once typing ends.
  document.addEventListener('focusout', () =>
    setTimeout(() => {
      if (document.activeElement.matches('input, textarea, select')) return;
      window.scrollTo(0, 0);
      settleLayout();
    }, 60)
  );

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
    reflectLog();
    showStart();
    showSplash();
    // a login is kept until the player logs out; without one the device stays off line
    restoreGameCenter();
    await checkLogin();
    if (isLoggedIn()) await goOnline();
    let url = null;
    if (window.rkCloud) {
      window.rkCloud.onUrl(handleUrl);
      url = await window.rkCloud.pendingUrl();
    }
    tidyHostedGames();
    if (window.rkPush) {
      window.rkPush.clearBadge().catch(() => {});
      const gid = await window.rkPush.pendingGame().catch(() => null);
      if (L.isId(gid)) return window.__rkOpenGame(gid);
    }
    if (url) handleUrl(url);
    else offerRejoin();
  }
  init();
})();
