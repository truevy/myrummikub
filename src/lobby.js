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
      createdAt: num(raw.createdAt),
      phase: ['lobby', 'playing', 'over'].includes(raw.phase) ? raw.phase : 'lobby',
      players: players.every(Boolean) ? players : [],
      devices: raw.devices && typeof raw.devices === 'object' ? Object.keys(raw.devices) : [],
      start: start && draws.every((d) => Number.isInteger(d) && d >= 0 && d <= 105) && Number.isInteger(start.current) ? { draws, current: start.current } : null,
    };
  }

  const stateOf = (presence) => (!presence || !presence.online ? 'offline' : presence.game ? 'playing' : 'online');

  // friends: [{ pid, name, face, photo, presence }] → counts plus a sorted list
  function friendsSummary(friends) {
    const list = friends
      .map((f) => ({ ...f, state: stateOf(f.presence) }))
      .sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));
    return {
      online: list.filter((f) => f.state !== 'offline').length,
      playing: list.filter((f) => f.state === 'playing').length,
      free: list.filter((f) => f.state === 'online').length,
      list,
    };
  }
  const rank = (state) => ({ online: 0, playing: 1, offline: 2 })[state];

  // "3 friends online, 2 playing right now"
  function summaryText(summary) {
    if (!summary.list.length) return 'No friends yet';
    const n = summary.online;
    let text = n === 0 ? 'No friends online' : `${n} friend${n === 1 ? '' : 's'} online`;
    if (summary.playing) text += `, ${summary.playing} playing right now`;
    return text;
  }

  // ---- invitation links and messages ----------------------------------------------

  const buildJoinLink = (scheme, token) => `${scheme}://join?t=${token}`;

  // the token in a join link, or null for anything else
  function parseJoinUrl(url, scheme) {
    if (typeof url !== 'string' || url.length > 300) return null;
    const m = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/join\/?\?t=([0-9a-f]{8,64})$/i);
    return m && m[1].toLowerCase() === scheme ? m[2].toLowerCase() : null;
  }

  function inviteMessage({ hostName, link, releasesUrl }) {
    return (
      `${hostName} invites you to a game of Rummi-Tumi!\n\n` +
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
  function canStart(seats) {
    const filled = Object.values(seats).filter(Boolean);
    return filled.length >= 2 && filled.length <= 4 && filled.every((s) => s.status === 'ready');
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
    stateOf,
    friendsSummary,
    summaryText,
    buildJoinLink,
    parseJoinUrl,
    inviteMessage,
    smsUrl,
    mailtoUrl,
    inviteStatus,
    statusText,
    laterUntil,
    canStart,
    freeSeat,
    fmtElapsed,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RK = Object.assign(root.RK || {}, { lobby: api });
})(typeof self !== 'undefined' ? self : this);
