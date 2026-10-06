// Pure helpers for online play: tidying records read from the database,
// summarising who is online, invitation links and messages, and the state of
// a lobby. No Firebase and no DOM, usable from node.
(function (root) {
  const ID = /^[0-9a-f]{8,64}$/;
  const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  const LATER_MINUTES = [5, 10, 15, 30];

  const isId = (v) => typeof v === 'string' && ID.test(v);
  const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : '');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

  // players/{pid} as read back; null when it is not usable
  function cleanPlayerRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = str(raw.name, 12);
    const face = str(raw.face, 8);
    if (!str(raw.device, 128) || !name || !face) return null;
    const photo = typeof raw.photo === 'string' && raw.photo.length < 64000 && PHOTO.test(raw.photo) ? raw.photo : null;
    return { device: raw.device, name, face, photo, updatedAt: num(raw.updatedAt) };
  }

  // presence/{pid} as read back; a missing record means offline
  function cleanPresence(raw) {
    if (!raw || typeof raw !== 'object') return { online: false, game: null, at: 0 };
    return { online: raw.online === true, game: isId(raw.game) ? raw.game : null, at: num(raw.at) };
  }

  // friends/{pid}/{other} as read back
  function cleanFriendRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return { name: str(raw.name, 12) || '?', face: str(raw.face, 8) || '🙂', since: num(raw.since) };
  }

  // a person as named inside invites, seats and game metadata
  function cleanPerson(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!isId(raw.pid) || !str(raw.device, 128)) return null;
    return { pid: raw.pid, device: raw.device, name: str(raw.name, 12) || '?', face: str(raw.face, 8) || '🙂' };
  }

  // invites/{token} as read back
  function cleanInvite(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const from = cleanPerson(raw.from);
    if (!isId(raw.game) || !from || !/^[0-3]$/.test(String(raw.seat))) return null;
    const claimed =
      raw.claimed && typeof raw.claimed === 'object' && str(raw.claimed.device, 128)
        ? {
            device: raw.claimed.device,
            pid: isId(raw.claimed.pid) ? raw.claimed.pid : null,
            status: ['received', 'registering', 'joining'].includes(raw.claimed.status) ? raw.claimed.status : 'received',
            at: num(raw.claimed.at),
          }
        : null;
    const answer =
      raw.answer && typeof raw.answer === 'object' && ['decline', 'later'].includes(raw.answer.kind)
        ? { kind: raw.answer.kind, minutes: LATER_MINUTES.includes(raw.answer.minutes) ? raw.answer.minutes : 10, at: num(raw.answer.at) }
        : null;
    return {
      game: raw.game,
      seat: String(raw.seat),
      from,
      to: isId(raw.to) ? raw.to : null,
      createdAt: num(raw.createdAt),
      claimed,
      answer,
      revoked: raw.revoked === true,
    };
  }

  // games/{gid}/seats/{n} as read back
  function cleanSeat(raw) {
    const p = cleanPerson(raw);
    if (!p) return null;
    return { ...p, token: isId(raw.token) ? raw.token : null, status: raw.status === 'ready' ? 'ready' : 'joining', at: num(raw.at) };
  }

  // games/{gid}/meta as read back
  function cleanMeta(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!isId(raw.host) || !str(raw.hostDevice, 128)) return null;
    const players = Array.isArray(raw.players) ? raw.players.map(cleanPerson) : Object.values(raw.players || {}).map(cleanPerson);
    const start = raw.start && typeof raw.start === 'object' ? raw.start : null;
    const draws = start && Array.isArray(start.draws) ? start.draws : start && start.draws ? Object.values(start.draws) : [];
    return {
      host: raw.host,
      hostDevice: raw.hostDevice,
      name: str(raw.name, 30),
      createdAt: num(raw.createdAt),
      startedAt: num(raw.startedAt),
      phase: ['lobby', 'playing', 'over'].includes(raw.phase) ? raw.phase : 'lobby',
      players: players.every(Boolean) ? players : [],
      devices: raw.devices && typeof raw.devices === 'object' ? Object.keys(raw.devices) : [],
      start: start && draws.every((d) => Number.isInteger(d) && d >= 0 && d <= 105) && Number.isInteger(start.current) ? { draws, current: start.current } : null,
    };
  }

  // games/{gid}/chat/{id} as read back
  function cleanChat(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = typeof raw.text === 'string' ? raw.text.slice(0, 300) : '';
    if (!text.trim() || !str(raw.device, 128)) return null;
    return { device: raw.device, pid: isId(raw.pid) ? raw.pid : null, name: str(raw.name, 12) || '?', text, at: num(raw.at) };
  }

  const stateOf = (presence) => (!presence || !presence.online ? 'offline' : presence.game ? 'playing' : 'online');

  // friends: [{ pid, name, face, photo, presence }] → counts plus a sorted list
  function friendsSummary(friends) {
    const list = friends
      .map((f) => ({ ...f, state: stateOf(f.presence) }))
      // those who were around most recently come first among the absent
      .sort((a, b) => rank(a.state) - rank(b.state) || (a.state === 'offline' ? seenAt(b) - seenAt(a) : 0) || a.name.localeCompare(b.name));
    return {
      online: list.filter((f) => f.state !== 'offline').length,
      playing: list.filter((f) => f.state === 'playing').length,
      free: list.filter((f) => f.state === 'online').length,
      list,
    };
  }
  const rank = (state) => ({ online: 0, playing: 1, offline: 2 })[state];
  const seenAt = (f) => (f.presence && f.presence.at) || 0;

  // When a player could last be invited: "Available now", "Playing now", or
  // how long ago they went offline (presence.at is stamped as they leave).
  function lastAvailableText(presence, now) {
    const state = stateOf(presence);
    if (state === 'online') return 'Available now';
    if (state === 'playing') return 'Playing now';
    if (!presence || !presence.at) return 'Not seen online yet';
    const min = Math.floor(Math.max(0, now - presence.at) / 60000);
    const n = (count, word) => `Last available ${count} ${word}${count === 1 ? '' : 's'} ago`;
    if (min < 1) return 'Last available just now';
    if (min < 60) return n(min, 'minute');
    if (min < 24 * 60) return n(Math.floor(min / 60), 'hour');
    if (min < 30 * 24 * 60) return n(Math.floor(min / (24 * 60)), 'day');
    return 'Last available on ' + new Date(presence.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // "3 friends online, 2 playing right now"
  function summaryText(summary) {
    if (!summary.list.length) return 'No friends yet';
    const n = summary.online;
    let text = n === 0 ? 'No friends online' : `${n} friend${n === 1 ? '' : 's'} online`;
    if (summary.playing) text += `, ${summary.playing} playing right now`;
    return text;
  }

  // ---- names and rankings --------------------------------------------------------

  // The key a name is registered under, so that "Sara", "sara" and " SARA "
  // are one name. Safe as a database key.
  function nameKey(name) {
    const tidy = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return tidy ? encodeURIComponent(tidy).replace(/\./g, '%2E') : '';
  }

  // rankings/{pid} as read back
  function cleanRanking(pid, raw) {
    if (!isId(pid) || !raw || typeof raw !== 'object') return null;
    const games = Math.max(0, Math.floor(num(raw.games)));
    const wins = Math.min(games, Math.max(0, Math.floor(num(raw.wins))));
    if (!games) return null;
    return { pid, name: str(raw.name, 12) || '?', face: str(raw.face, 8) || '🙂', games, wins, at: num(raw.at) };
  }

  // Most wins first, then the better win rate, then whoever played last.
  // Equal records share a rank.
  function rankPlayers(list) {
    const sorted = list.slice().sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || b.at - a.at);
    let rank = 0;
    return sorted.map((r, i) => {
      const prev = sorted[i - 1];
      if (!prev || prev.wins !== r.wins || prev.games !== r.games) rank = i + 1;
      return { ...r, rank };
    });
  }

  // ---- invitation links and messages ----------------------------------------------

  const buildJoinLink = (scheme, token) => `${scheme}://join?t=${token}`;

  // A sign-in link (scheme://auth?provider=apple&c=…) carries the result of a
  // Sign in with Apple done in the browser back to the app. Returns
  // { provider, credential (JSON text), name } or { error }, or null for
  // other links.
  function parseAuthUrl(url, scheme) {
    if (typeof url !== 'string' || url.length > 8000) return null;
    const m = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/auth\/?\?(.*)$/i);
    if (!m || m[1].toLowerCase() !== scheme) return null;
    const q = new URLSearchParams(m[2]);
    if (q.get('error')) return { error: str(q.get('error'), 300) };
    const provider = q.get('provider') || 'apple';
    if (provider !== 'apple') return { error: 'Only Sign in with Apple is supported.' };
    let credential = '';
    try {
      credential = decodeURIComponent(escape(atob(q.get('c') || '')));
      JSON.parse(credential);
    } catch (err) {
      return { error: 'The sign-in link is damaged.' };
    }
    return { provider, credential, name: str(q.get('name') || '', 40) };
  }

  // the token in a join link, or null for anything else
  function parseJoinUrl(url, scheme) {
    if (typeof url !== 'string' || url.length > 300) return null;
    const m = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/join\/?\?t=([0-9a-f]{8,64})$/i);
    return m && m[1].toLowerCase() === scheme ? m[2].toLowerCase() : null;
  }

  function inviteMessage({ hostName, link, releasesUrl, gameName }) {
    return (
      `${hostName} invites you to a game of Lynda's Rummi Time${gameName ? ` (“${gameName}”)` : ''}!\n\n` +
      `Open this link on your computer to join:\n${link}\n\n` +
      `Don't have the game yet? Download it here, then open the link again:\n${releasesUrl}`
    );
  }

  // Messages and Mail links with the text filled in; the sender presses send.
  const smsUrl = (handle, text) => `sms:${handle || ''}&body=${encodeURIComponent(text)}`;
  const mailtoUrl = (handle, text, subject) => `mailto:${handle || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  // ---- lobby state -------------------------------------------------------------------

  // What one invitation is up to, from its record and (if any) the seat it fills.
  function inviteStatus(invite, seat, now, ttlMs) {
    if (!invite || invite.revoked) return 'removed';
    if (seat && seat.status === 'ready') return 'ready';
    if (invite.answer && invite.answer.kind === 'decline') return 'declined';
    if (invite.answer && invite.answer.kind === 'later') return 'later';
    if (seat) return 'joining';
    if (invite.claimed) return invite.claimed.status; // received | registering | joining
    if (ttlMs && invite.createdAt && now - invite.createdAt > ttlMs) return 'expired';
    return 'sent';
  }

  const STATUS_TEXT = {
    sent: 'Invite sent',
    received: 'Invite received',
    registering: 'Pending registration',
    joining: 'Joining game',
    ready: 'Ready',
    declined: 'Declined',
    later: 'Ready later',
    expired: 'Invite expired',
    removed: 'Removed',
  };
  const statusText = (status) => STATUS_TEXT[status] || status;

  // when a "ready in N minutes" answer runs out
  const laterUntil = (invite) => (invite && invite.answer && invite.answer.kind === 'later' ? invite.answer.at + invite.answer.minutes * 60000 : 0);

  // seats: cleaned seat records by index; a game needs 2–4 ready people
  // A game can start once everyone seated is ready. People whose invitations
  // are still open keep their seats and can join later, so nobody has to be
  // waited for. Two to four players, counting the absent ones.
  function canStart(seats, pending = []) {
    const filled = Object.values(seats).filter(Boolean);
    const total = filled.length + pending.length;
    return total >= 2 && total <= 4 && filled.every((s) => s.status === 'ready');
  }

  // ---- games that wait for people -------------------------------------------

  const NO_DEVICE = 'none'; // the device of a seat whose player has not joined yet
  const isAbsent = (person) => !!person && person.device === NO_DEVICE;

  // The seat of someone who has not joined: a friend who was invited, or a
  // placeholder for a link that nobody has opened yet.
  function absentPerson(invite, seat, friend) {
    if (friend) return { pid: friend.pid, device: NO_DEVICE, name: friend.name, face: friend.face };
    return { pid: invite.token || invite.game, device: NO_DEVICE, name: 'Guest ' + (Number(seat) + 1), face: '✉️' };
  }

  // A game with someone still to join lasts this long; one where everyone has
  // joined goes on until it is finished.
  const ABSENT_GAME_MS = 2 * 24 * 60 * 60 * 1000;
  function expiresAt(meta) {
    if (!meta || meta.phase !== 'playing' || !meta.players.some(isAbsent)) return 0;
    return (meta.startedAt || meta.createdAt) + ABSENT_GAME_MS;
  }

  const defaultGameName = (hostName, count) => `${hostName}'s game${count > 1 ? ' ' + count : ''}`;
  const cleanGameName = (name) => str(name, 30).replace(/\s+/g, ' ').trim();

  // "2 h ago", "3 d ago"
  function fmtAgo(ms) {
    const min = Math.floor(Math.max(0, ms) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' h ago';
    return Math.floor(h / 24) + ' d ago';
  }

  // the lowest seat index not yet taken by a seat or a live invitation
  function freeSeat(seats, invites) {
    const taken = new Set(Object.keys(seats).filter((n) => seats[n]));
    for (const inv of invites) if (inv && !inv.revoked && !['declined', 'expired'].includes(inviteStatus(inv, null, 0, 0))) taken.add(inv.seat);
    for (let n = 0; n < 4; n++) if (!taken.has(String(n))) return String(n);
    return null;
  }

  // "m:ss" for a waiting counter
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const api = {
    LATER_MINUTES,
    isId,
    cleanPlayerRecord,
    cleanPresence,
    cleanFriendRecord,
    cleanPerson,
    cleanInvite,
    cleanSeat,
    cleanMeta,
    cleanChat,
    stateOf,
    friendsSummary,
    summaryText,
    lastAvailableText,
    nameKey,
    cleanRanking,
    rankPlayers,
    buildJoinLink,
    parseJoinUrl,
    parseAuthUrl,
    inviteMessage,
    smsUrl,
    mailtoUrl,
    inviteStatus,
    statusText,
    laterUntil,
    canStart,
    NO_DEVICE,
    isAbsent,
    absentPerson,
    ABSENT_GAME_MS,
    expiresAt,
    defaultGameName,
    cleanGameName,
    fmtAgo,
    freeSeat,
    fmtElapsed,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { lobby: api });
})(typeof self !== 'undefined' ? self : this);
