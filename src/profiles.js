// Registered players and the ledger of finished games. No DOM, usable from node.
//
// A profile is a person the owner of this computer knows: a stable id, a name,
// a picture and (optionally) the iMessage address they can be reached at.
// Statistics are never stored as counters. They are worked out from the ledger
// of finished games, each identified by its game id, so that ledgers from two
// computers can later be merged without counting a game twice.
(function (root) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.RK;

  const DB_VERSION = 1;
  const MAX_GAMES = 2000;
  const MAX_PHOTO_CHARS = 200000;
  const ID = /^[0-9a-f]{8,64}$/;
  const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

  const emptyDb = () => ({ version: DB_VERSION, profiles: [], games: [], lastPlayers: [] });
  const isId = (v) => typeof v === 'string' && ID.test(v);
  const isPhoto = (v) => typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && PHOTO.test(v);
  const cleanName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 12) : '');
  const cleanFace = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 8 ? v : '😀');
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : lo);

  // An iMessage address is a phone number or an email. Returns the tidied
  // address, '' for none, or null if it is neither.
  function cleanHandle(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (!s) return '';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 100) return s.toLowerCase();
    const digits = s.replace(/[\s().-]/g, '');
    if (/^\+?\d{7,15}$/.test(digits)) return digits;
    return null;
  }

  // Anything read from disk goes through here; bad entries are dropped.
  function cleanDb(raw) {
    const db = emptyDb();
    if (!raw || typeof raw !== 'object') return db;
    const names = new Set();
    for (const p of Array.isArray(raw.profiles) ? raw.profiles : []) {
      const name = cleanName(p && p.name);
      if (!p || !isId(p.id) || !name || names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      db.profiles.push({
        id: p.id,
        name,
        face: cleanFace(p.face),
        photo: isPhoto(p.photo) ? p.photo : null,
        handle: cleanHandle(p.handle) || '',
        cloud: p.cloud === true, // plays online from this computer
        createdAt: int(p.createdAt, 0, 1e14),
      });
    }
    const seen = new Set();
    for (const g of Array.isArray(raw.games) ? raw.games : []) {
      if (!g || !isId(g.id) || seen.has(g.id) || !Array.isArray(g.players)) continue;
      seen.add(g.id);
      db.games.push({
        id: g.id,
        endedAt: int(g.endedAt, 0, 1e14),
        reason: g.reason === 'stalemate' ? 'stalemate' : 'out',
        players: g.players.slice(0, 4).map((p) => ({
          profileId: p && isId(p.profileId) ? p.profileId : null,
          name: cleanName(p && p.name) || '?',
          isAI: !!(p && p.isAI),
          level: int(p && p.level, 0, 5),
          place: int(p && p.place, 1, 4),
          bestMove: int(p && p.bestMove, 0, 106),
          tiles: int(p && p.tiles, 0, 106),
        })),
      });
    }
    db.games = db.games.slice(-MAX_GAMES);
    db.lastPlayers = (Array.isArray(raw.lastPlayers) ? raw.lastPlayers : []).map(cleanName).filter(Boolean).slice(0, 4);
    return db;
  }

  const findById = (db, id) => db.profiles.find((p) => p.id === id) || null;
  const findByName = (db, name) => {
    const key = cleanName(name).toLowerCase();
    return (key && db.profiles.find((p) => p.name.toLowerCase() === key)) || null;
  };

  // Creates or updates a profile. Throws an Error with a readable message.
  function saveProfile(db, { id, name, face, photo, handle, cloud }) {
    const clean = cleanName(name);
    if (!clean) throw new Error('Please enter a name.');
    const clash = findByName(db, clean);
    if (clash && clash.id !== id) throw new Error(`“${clash.name}” is already registered.`);
    const addr = cleanHandle(handle);
    if (addr === null) throw new Error('The iMessage contact should be a phone number or an email address.');
    if (photo && !isPhoto(photo)) throw new Error('That photo could not be used.');
    let profile = id ? findById(db, id) : null;
    if (!profile) {
      profile = { id: E.newId(), createdAt: Date.now() };
      db.profiles.push(profile);
    }
    Object.assign(profile, { name: clean, face: cleanFace(face), photo: photo || null, handle: addr, cloud: cloud === true });
    return profile;
  }

  // A player this account already has on another device arrives here: as a
  // new profile, or taking over a local one of the same name (with its games).
  function adoptProfile(db, { id, name, face, photo }) {
    let profile = findById(db, id);
    if (!profile) {
      const same = findByName(db, cleanName(name));
      if (same) {
        for (const g of db.games) for (const p of g.players) if (p.profileId === same.id) p.profileId = id;
        same.id = id;
        profile = same;
      } else {
        profile = { id, createdAt: Date.now(), handle: '' };
        db.profiles.push(profile);
      }
    }
    Object.assign(profile, { name: cleanName(name) || profile.name, face: cleanFace(face), photo: isPhoto(photo) ? photo : profile.photo || null, cloud: true });
    return profile;
  }

  // The finished games stay in the ledger; they just no longer belong to anyone.
  function removeProfile(db, id) {
    db.profiles = db.profiles.filter((p) => p.id !== id);
  }

  // Adds a finished game to the ledger. Recording the same game again does
  // nothing, so this is safe to call more than once.
  function recordGame(db, game, now = Date.now()) {
    if (!game.over || !game.result || db.games.some((g) => g.id === game.id)) return false;
    db.games.push({
      id: game.id,
      endedAt: now,
      reason: game.result.reason,
      players: game.players.map((p) => {
        const turns = game.history.filter((h) => h.player === p.id && h.type === 'play');
        return {
          profileId: p.profileId || null,
          name: p.name,
          isAI: p.isAI,
          level: p.level || 0,
          place: game.result.ranking.indexOf(p.id) + 1,
          bestMove: turns.reduce((m, h) => Math.max(m, h.count), 0),
          tiles: turns.reduce((s, h) => s + h.count, 0),
        };
      }),
    });
    if (db.games.length > MAX_GAMES) db.games = db.games.slice(-MAX_GAMES);
    return true;
  }

  function statsFor(db, profileId) {
    const stats = { games: 0, wins: 0, bestMove: 0, tiles: 0, lastPlayed: 0 };
    for (const g of db.games) {
      const me = g.players.find((p) => p.profileId === profileId);
      if (!me) continue;
      stats.games++;
      if (me.place === 1) stats.wins++;
      stats.bestMove = Math.max(stats.bestMove, me.bestMove);
      stats.tiles += me.tiles;
      stats.lastPlayed = Math.max(stats.lastPlayed, g.endedAt);
    }
    return stats;
  }

  // People who could be sent an invitation: registered and reachable.
  const invitable = (db) => db.profiles.filter((p) => p.handle);
  // People who play online from this computer.
  const cloudProfiles = (db) => db.profiles.filter((p) => p.cloud);

  const api = {
    emptyDb,
    cleanDb,
    cleanHandle,
    isPhoto,
    findById,
    findByName,
    saveProfile,
    adoptProfile,
    removeProfile,
    recordGame,
    statsFor,
    invitable,
    cloudProfiles,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { profiles: api });
})(typeof self !== 'undefined' ? self : this);
