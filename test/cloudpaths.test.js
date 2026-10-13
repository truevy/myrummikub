const test = require('node:test');
const assert = require('node:assert');

// A stand-in for the Firebase library that only remembers which paths were asked for.
function fakeFirebase(paths) {
  const snap = { val: () => null, exists: () => false, forEach() {} };
  const ref = (p) => {
    paths.push(p);
    const r = {
      on() {},
      off() {},
      once: async () => snap,
      get: async () => snap,
      set: async () => {},
      update: async () => {},
      remove: async () => {},
      transaction: async (fn) => {
        fn(null);
        return { committed: true, snapshot: snap };
      },
      push: () => ({ key: 'k', set: async () => {} }),
      onDisconnect: () => ({ set: async () => {}, remove: async () => {}, cancel: async () => {} }),
      orderByChild: () => r,
      limitToLast: () => r,
      limitToFirst: () => r,
      endAt: () => r,
      child: () => r,
    };
    return r;
  };
  const database = () => ({ ref, INTERNAL: { forceWebSockets() {} }, goOnline() {}, goOffline() {} });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  return {
    initializeApp() {},
    database,
    auth: () => ({
      onAuthStateChanged: (cb) => {
        setTimeout(() => cb({ uid: 'device1' }), 0);
        return () => {};
      },
      signInAnonymously: async () => ({ user: { uid: 'device1' } }),
      currentUser: { uid: 'device1' },
    }),
  };
}

test('everything the app stores online goes under v3, apart from the connection clock', async () => {
  const paths = [];
  const lobby = require('../src/lobby.js');
  globalThis.self = {
    RK: {
      lobby,
      newId: () => 'a'.repeat(32),
      CLOUD: { firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } },
    },
    firebase: fakeFirebase(paths),
  };
  try {
    delete require.cache[require.resolve('../src/cloud.js')];
    require('../src/cloud.js');
    const C = globalThis.self.RK.cloud;
    const pid = 'b'.repeat(16);
    const other = 'c'.repeat(16);
    const person = { pid, device: 'device1', name: 'Ann', face: '🦄' };
    const calls = [
      () => C.publishPlayer({ id: pid, name: 'Ann', face: '🦄', handle: 'ann_1', visibility: 'public', multi: false }),
      () => C.claimName('Ann', pid),
      () => C.nameOwner('Ann'),
      () => C.releaseName('Ann', pid),
      () => C.claimHandle('ann_1', pid),
      () => C.handleOwner('ann_1'),
      () => C.readUserCount(),
      () => C.lookupHandle('ann_1'),
      () => C.releaseHandle('ann_1', pid),
      () => C.readPlayer(pid),
      () => C.removePlayer(pid),
      () => C.addFriend(pid, other, { name: 'Bo', face: '🐸' }),
      () => C.addRecent(pid, { pid: other, name: 'Bo', face: '🐸', handle: 'bo_1' }, 'private'),
      () => C.joinQueue({ pid, size: 2, hints: false, help: false, cols: 30 }),
      () => C.leaveQueue(),
      () => C.createGame(person, 'Game', { hints: 3, help: true, chat: true, kind: 'private' }),
      () => C.nameGame('d'.repeat(16), 'Game'),
      () => C.addMyGame('d'.repeat(16), { name: 'Game', host: true }),
      () => C.requestHelp('d'.repeat(16), 0, 1),
      () => C.clearHelp('d'.repeat(16), 0),
      () => C.readMeta('d'.repeat(16)),
      () => C.readState('d'.repeat(16)),
      () => C.setPresence([pid], null),
      () => C.createInvite({ gid: 'd'.repeat(16), seat: 1, from: person, toPid: other }),
      () => C.readInvite('e'.repeat(32)),
      () => C.readRankings(),
      () => C.sendChat('d'.repeat(16), { pid, name: 'Ann' }, 'hello'),
      () => C.watchQueue(() => {}),
      () => C.watchRecent([pid], () => {}),
      () => C.watchHelp('d'.repeat(16), () => {}),
      () => C.watchMeta('d'.repeat(16), () => {}),
      () => C.watchState('d'.repeat(16), () => {}),
      () => C.watchChat('d'.repeat(16), () => {}),
      () => C.watchSeats('d'.repeat(16), () => {}),
      () => C.watchMyGames(() => {}),
      () => C.watchFriends([pid], () => {}),
    ];
    for (const call of calls) {
      try {
        await call();
      } catch (err) {
        // the fake database answers with nothing; only the paths matter here
      }
    }
    assert.ok(paths.length > 25, `the calls asked for ${paths.length} paths`);
    const stray = paths.filter((p) => !(p === 'v3' || p.startsWith('v3/') || p.startsWith('.info/')));
    assert.deepStrictEqual(stray, [], 'paths outside v3');
    assert.ok(paths.some((p) => p.startsWith('v3/handles/')), 'handles are under v3');
    assert.ok(paths.some((p) => p.startsWith('v3/queue/')), 'the queue is under v3');
    assert.ok(paths.includes('v3/stats/users'), 'the user count is under v3');
  } finally {
    delete globalThis.self;
  }
});
