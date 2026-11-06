const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { RulesDb } = require('./helpers/rulesdb.js');
const lobby = require('../src/lobby.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CLOUD_SRC = read('src/cloud.js');
const hex = (c) => c.repeat(16);

// A pretend Apple: which account each Apple ID belongs to, shared by every device.
function appleWorld() {
  return { owners: new Map(), revoked: [] };
}

// A device whose sign-in can change: its database writes are made as whoever is signed in now.
function device(db, world, firstUid) {
  const state = { uid: firstUid, providers: [] };
  const fbFor = () => db.firebaseFor(state.uid);
  const credential = ({ idToken, rawNonce }) => ({ providerId: 'apple.com', appleId: idToken, rawNonce });
  const user = {
    get uid() {
      return state.uid;
    },
    get providerData() {
      return state.providers.map((providerId) => ({ providerId }));
    },
    async linkWithCredential(cred) {
      if (state.providers.includes('apple.com')) throw Object.assign(new Error('linked'), { code: 'auth/provider-already-linked' });
      if (world.owners.has(cred.appleId)) throw Object.assign(new Error('in use'), { code: 'auth/credential-already-in-use', credential: { ...cred, fresh: true } });
      world.owners.set(cred.appleId, state.uid);
      state.providers.push('apple.com');
    },
    async reauthenticateWithCredential(cred) {
      if (world.owners.get(cred.appleId) !== state.uid) throw Object.assign(new Error('mismatch'), { code: 'auth/user-mismatch' });
    },
    async delete() {},
  };
  const auth = () => ({
    onAuthStateChanged: (cb) => (setTimeout(() => cb({ uid: state.uid }), 0), () => {}),
    signInAnonymously: async () => ({ user }),
    get currentUser() {
      return user;
    },
    async signInWithCredential(cred) {
      assert.ok(cred.fresh, 'switches with the credential Firebase handed back, not the used-up one');
      state.uid = world.owners.get(cred.appleId);
      state.providers = ['apple.com'];
      return { user };
    },
    async revokeAccessToken(code) {
      world.revoked.push(code);
    },
    signOut: async () => {},
  });
  auth.OAuthProvider = function (id) {
    assert.strictEqual(id, 'apple.com');
    this.credential = credential;
  };
  const firebase = {
    initializeApp() {},
    database: () => ({ ref: (p) => fbFor().database().ref(p), INTERNAL: { forceWebSockets() {} } }),
    auth,
  };
  firebase.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  const self = {
    RK: {
      lobby,
      newId: () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      CLOUD: { inviteTtlMs: 24 * 3600 * 1000, firebase: { apiKey: 'k', authDomain: 'a', databaseURL: 'https://x.firebaseio.com', projectId: 'p', appId: 'i' } },
    },
    firebase,
  };
  new Function('self', CLOUD_SRC)(self);
  return { cloud: self.RK.cloud, state };
}

test('an Apple ID is tied to the account the first time', async () => {
  const db = new RulesDb();
  const world = appleWorld();
  const A = device(db, world, 'devA');
  await A.cloud.publishPlayer({ id: hex('a'), name: 'Ann', face: '🦄' });
  assert.strictEqual(await A.cloud.appleAccount(), null);
  const result = await A.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'n', });
  assert.deepStrictEqual(result, { linked: true });
  assert.deepStrictEqual(A.cloud.signedInWith(), ['apple.com']);
  assert.deepStrictEqual(await A.cloud.appleAccount(), { });
  assert.strictEqual(db.denied.length, 0, JSON.stringify(db.denied));
});

test('another device signed in with the same Apple ID plays as the same players, but only when it says so', async () => {
  const db = new RulesDb();
  const world = appleWorld();
  const A = device(db, world, 'devA');
  const ann = { id: hex('a'), name: 'Ann', face: '🦄' };
  await A.cloud.publishPlayer(ann);
  await A.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'n', });

  const B = device(db, world, 'devB');
  await B.cloud.init();
  const result = await B.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'm' });
  assert.strictEqual(result.other, true);
  assert.strictEqual(B.state.uid, 'devB', 'nothing changes before the switch is confirmed');
  const { players } = await result.switchTo();
  assert.strictEqual(B.state.uid, 'devA');
  assert.deepStrictEqual(players.map((p) => [p.id, p.name]), [[ann.id, 'Ann']]);
  assert.deepStrictEqual(await B.cloud.appleAccount(), {});
  // the device can now publish as Ann
  await B.cloud.publishPlayer({ ...ann, face: '🦊' });
  assert.strictEqual(db.denied.length, 0, JSON.stringify(db.denied));
});

test('deleting an account tied to an Apple ID revokes Apple’s tokens first', async () => {
  const db = new RulesDb();
  const world = appleWorld();
  const A = device(db, world, 'devA');
  await A.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'n' });
  assert.strictEqual(await A.cloud.revokeApple({ idToken: 'apple-ann', nonce: 'n2', code: 'auth-code' }), true);
  assert.deepStrictEqual(world.revoked, ['auth-code']);
  // no code (the browser sign-in): nothing to tell Apple, and nothing fails
  assert.strictEqual(await A.cloud.revokeApple({ idToken: 'apple-ann', nonce: 'n3', code: '' }), false);
});

test('the app offers Sign in with Apple in the Online window and on a new device, and asks before switching players', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /\$\{appleRowHtml\(\)\}/);
  assert.match(ui, /id="who-apple"/);
  assert.match(ui, /if \(own\.length && !\(await confirmAppleSwitch\(own\)\)\) return done\(false\);/);
  assert.match(ui, /if \(L\.parseAuthUrl\(url, RK\.CLOUD\.scheme\)\) return handleAuthUrl\(url\);/);
  assert.match(ui, /if \(!takeAuthState\(auth\.state\)\) return toast/);
  assert.match(ui, /await C\.revokeApple\(apple\);\s+\$\('#del-status'\)\.textContent = 'Deleting your account…';\s+\}\s+await C\.deleteAccount\(mine\);/);
});

test('the iPhone and iPad app hands over the authorization code, and Android may open the sign-in page', () => {
  const swift = read('ios/RummiTummi/GameView.swift');
  assert.match(swift, /"code": code\]/);
  assert.match(swift, /requestedScopes = \[\]/, 'no name is asked for (the privacy policy says so)');
  assert.match(read('android/app/src/main/java/com/lyndasrummitummi/android/MainActivity.kt'), /https:\/\/lyndas-rummikub\.web\.app\/signin\.html\?/);
});
