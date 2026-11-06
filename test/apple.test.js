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
      return state.providers.map((providerId) => ({ providerId, email: providerId === 'apple.com' ? `${state.uid}@privaterelay.appleid.com` : '' }));
    },
    async linkWithCredential(cred) {
      if (state.providers.includes('apple.com')) throw Object.assign(new Error('linked'), { code: 'auth/provider-already-linked' });
      if (world.owners.has(cred.appleId)) {
        cred.spent = true; // Apple's token is good for one use
        throw Object.assign(new Error('in use'), { code: 'auth/credential-already-in-use', credential: world.noFreshCredential ? undefined : { ...cred, spent: false } });
      }
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
      if (cred.spent) throw Object.assign(new Error('Duplicate credential received.'), { code: 'auth/missing-or-invalid-nonce' });
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
  assert.deepStrictEqual(await A.cloud.appleAccount(), { email: 'devA@privaterelay.appleid.com' });
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
  assert.deepStrictEqual(await B.cloud.appleAccount(), { email: 'devA@privaterelay.appleid.com' }, 'the same Apple ID, and so the same email, on the other device');
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
  assert.match(swift, /requestedScopes = \[\.email\]/, 'the email, and no name, is asked for (as the privacy policy says)');
  assert.match(read('android/app/src/main/java/com/lyndasrummitummi/android/MainActivity.kt'), /https:\/\/lyndas-rummikub\.web\.app\/signin\.html\?/);
});

test('a device that switches to the Apple ID’s account stops getting the old account’s notifications', async () => {
  const db = new RulesDb();
  const world = appleWorld();
  const A = device(db, world, 'devA');
  await A.cloud.publishPlayer({ id: hex('a'), name: 'Ann', face: '🦄' });
  await A.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'n' });
  const B = device(db, world, 'devB');
  await B.cloud.savePushToken('phonetokenphonetoken', 'production');
  assert.ok(db.tree.v3.pushTokens.devB);
  const result = await B.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'm' });
  await result.switchTo();
  assert.ok(!db.tree.v3.pushTokens || !db.tree.v3.pushTokens.devB, 'the old account no longer has this phone');
  assert.strictEqual(db.denied.length, 0, JSON.stringify(db.denied));
});

test('log in and log out on the start screen, and the offer to tie an Apple ID at the start', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /'<button id="log-out">🔓 Log out…<\/button>' : C\.configured\(\) \? '<button id="log-in">🔑 Log in…<\/button>'/);
  assert.match(ui, /id="log-out-online">🔓 Log out…/);
  // logging out forgets the account's players here and this phone's notifications for it
  assert.match(ui, /await C\.clearPushToken\(\)\.catch\(\(\) => \{\}\);\s+pushAsked = false;\s+await C\.signOut\(\)/);
  assert.match(ui, /for \(const p of mine\) P\.removeProfile\(db, p\.id\);/);
  // an account with no way back in is warned, and offered Sign in with Apple first
  assert.match(ui, /const risky = !viaApple && !viaCode;/);
  assert.match(ui, /id="lo-apple"/);
  // the offer: only online, only without an Apple ID, and "Don't ask again" is remembered
  assert.match(ui, /else if \(!maybeOfferApple\(\)\) scheduleActiveGames\(\);/);
  assert.match(ui, /if \(C\.signedInWith\(\)\.includes\('apple\.com'\)\) return false;/);
  assert.match(ui, /settings\.appleNever = saved\.appleNever === true;/);
});

test('"Your games" goes back to the home screen', () => {
  assert.match(read('src/ui.js'), /id="active-new">🏠 Home<\/button>[\s\S]{0,200}\$\('#active-new'\)\.onclick = showStart;/);
});

test('a notification that arrives while the app is open is shown, unless it is about the game on screen', () => {
  const push = read('ios/RummiTummi/PushDelegate.swift');
  assert.match(push, /completionHandler\(!gid\.isEmpty && gid == showing \? \[\] : \[\.banner, \.list, \.sound, \.badge\]\)/);
  assert.doesNotMatch(push, /completionHandler\(\[\]\)\n/);
  assert.match(read('ios/RummiTummi/GameView.swift'), /func showingGame\(_ done: @escaping \(String\) -> Void\)/);
  assert.match(read('src/ui.js'), /window\.__rkShowingGame = \(\) =>/);
});

test('a failed Apple sign-in is explained in plain words, stays on screen, and cancelling says nothing', () => {
  const audience = { code: 'auth/invalid-credential', message: 'Firebase: The audience in ID Token [com.lyndasrummitummi.ios] does not match the expected audience. (auth/invalid-credential).' };
  assert.match(lobby.explainSignInError(audience), /does not accept this app’s Apple sign-in yet[\s\S]*Nothing was changed/);
  assert.doesNotMatch(lobby.explainSignInError(audience), /Firebase|auth\//);
  assert.strictEqual(lobby.explainSignInError('Sign-in cancelled.'), '');
  assert.strictEqual(lobby.explainSignInError({ code: 'auth/weird', message: 'Firebase: Something odd (auth/weird).' }), 'Something odd');
  const ui = read('src/ui.js');
  assert.match(ui, /function showSignInProblem\(err, done\) \{\s+const text = L\.explainSignInError\(err\);\s+if \(!text\) return done\(false\);\s+showCard\(/);
  assert.doesNotMatch(ui, /toast\('Sign in with Apple did not work: '/);
});

test('“My handle and picture” shows the Apple ID’s email, with Sign in with Apple or Log out', () => {
  const ui = read('src/ui.js');
  assert.match(ui, /\$\{existing && draft\.cloud && appleHere\(\) && C\.configured\(\) \? '<div class="label">Apple ID<\/div>/);
  assert.match(ui, /fillProfileApple\(\$\('#pf-apple'\), \(\) => showProfile\(start, done\), stopCamera\);/);
  assert.match(ui, /apple\.email \? esc\(apple\.email\) : 'Apple did not share an email address'/);
  assert.match(ui, /id="pf-logout">🔓 Log out…/);
  assert.match(ui, /id="pf-apple-in">\$\{appleMark\}Sign in with Apple/);
  // the privacy policy says what is now asked for
  const policy = read('hosting/privacy.html');
  assert.match(policy, /the email address you choose\s+to share/);
  assert.doesNotMatch(policy, /does not ask Apple for your name or your\s+email/);
  assert.match(read('hosting/signin.html'), /p\.addScope\('email'\);/);
});

test('when Firebase hands back no fresh credential, switching asks Apple for a new sign-in instead of failing', async () => {
  const db = new RulesDb();
  const world = appleWorld();
  world.noFreshCredential = true;
  const A = device(db, world, 'devA');
  const ann = { id: hex('a'), name: 'Ann', face: '🦄' };
  await A.cloud.publishPlayer(ann);
  await A.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'n' });
  // a second device that already has a player of its own
  const B = device(db, world, 'devB');
  await B.cloud.publishPlayer({ id: hex('b'), name: 'Bob', face: '🦊' });
  const result = await B.cloud.signInWithApple({ idToken: 'apple-ann', nonce: 'm' });
  assert.strictEqual(result.other, true);
  // without a way to sign in again, the used-up token fails (what the player saw)
  await assert.rejects(result.switchTo(), /Duplicate credential/);
  // with Apple's sheet at hand, a fresh token is used and the device plays as Ann
  let asked = 0;
  const { players } = await result.switchTo(async () => (asked++, { idToken: 'apple-ann', nonce: 'fresh' }));
  assert.strictEqual(asked, 1);
  assert.strictEqual(B.state.uid, 'devA');
  assert.deepStrictEqual(players.map((p) => p.name), ['Ann']);
  const ui = read('src/ui.js');
  assert.match(ui, /finishAppleSignIn\(\(\) => C\.signInWithApple\(apple\), done, \(\) => window\.rkApple\.signIn\(\)\)/);
  assert.match(ui, /await result\.switchTo\(again\)/);
});
