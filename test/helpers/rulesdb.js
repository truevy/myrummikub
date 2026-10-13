// A stand-in for Firebase's Realtime Database that applies the real security
// rules in database.rules.json to every read and write, so that the app's own
// code (src/cloud.js) can be run against them without a Firebase project or the
// emulator. It covers the parts of the rules language this project uses:
// auth, now, root, data, newData, $wildcards, child/parent/val/exists/hasChild/
// hasChildren/isString/isNumber/isBoolean/matches. Not a complete implementation.
const fs = require('node:fs');
const path = require('node:path');

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'database.rules.json'), 'utf8')).rules;

if (!String.prototype.matches) {
  // the rules language writes string.matches(/regex/)
  Object.defineProperty(String.prototype, 'matches', { value: function (re) { return re.test(String(this)); }, enumerable: false });
}

const split = (p) => String(p).split('/').filter(Boolean);
const clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

// Firebase stores arrays as objects, drops nulls and empty objects
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => (o[i] = x));
    return normalize(o);
  }
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      const n = normalize(v[k]);
      if (n !== null) o[k] = n;
    }
    return Object.keys(o).length ? o : null;
  }
  return v;
}

const getAt = (tree, parts) => {
  let cur = tree;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in cur)) return null;
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
};

function setAt(tree, parts, value) {
  const next = clone(tree) || {};
  if (!parts.length) return normalize(value) || {};
  let cur = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const v = normalize(value);
  if (v === null) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = v;
  return normalize(next) || {};
}

// ---- the rules language ----------------------------------------------------------

function snapshot(tree, parts) {
  const val = getAt(tree, parts);
  const s = {
    val: () => val,
    exists: () => val !== null,
    child: (p) => snapshot(tree, parts.concat(split(p))),
    parent: () => snapshot(tree, parts.slice(0, -1)),
    hasChild: (p) => getAt(tree, parts.concat(split(p))) !== null,
    hasChildren: (list) => {
      if (val === null || typeof val !== 'object') return false;
      return list ? list.every((k) => k in val) : Object.keys(val).length > 0;
    },
    isString: () => typeof val === 'string',
    isNumber: () => typeof val === 'number',
    isBoolean: () => typeof val === 'boolean',
  };
  return s;
}

const compiled = new Map();
function evaluate(expr, ctx, vars) {
  const names = Object.keys(vars);
  const key = names.join(',') + '|' + expr;
  if (!compiled.has(key)) compiled.set(key, new Function('auth', 'now', 'root', 'data', 'newData', ...names, `return (${expr});`));
  try {
    return compiled.get(key)(ctx.auth, ctx.now, ctx.root, ctx.data, ctx.newData, ...names.map((n) => vars[n])) === true;
  } catch (err) {
    return false; // a rule that throws (a missing value, say) is false
  }
}

// the rule node under `node` for the key `k`, and the wildcard it matched
function child(node, k) {
  if (node && typeof node === 'object') {
    if (k in node && !k.startsWith('.')) return { node: node[k], vars: {} };
    const wild = Object.keys(node).find((n) => n.startsWith('$'));
    if (wild) return { node: node[wild], vars: { [wild]: k } };
  }
  return { node: null, vars: {} };
}

function allowedRead(tree, parts, auth, now) {
  let node = RULES;
  let vars = {};
  for (let i = 0; i <= parts.length; i++) {
    if (node && typeof node['.read'] === 'string') {
      const ctx = { auth, now, root: snapshot(tree, []), data: snapshot(tree, parts.slice(0, i)), newData: snapshot(tree, parts.slice(0, i)) };
      if (evaluate(node['.read'], ctx, vars)) return true;
    } else if (node && node['.read'] === true) return true;
    if (i === parts.length) break;
    const c = child(node, parts[i]);
    node = c.node;
    vars = { ...vars, ...c.vars };
    if (!node) break;
  }
  return false;
}

function validateSubtree(ruleNode, vars, oldTree, newTree, parts, auth, now, why) {
  if (!ruleNode || typeof ruleNode !== 'object') return true;
  const ctx = { auth, now, root: snapshot(oldTree, []), data: snapshot(oldTree, parts), newData: snapshot(newTree, parts) };
  const val = getAt(newTree, parts);
  if (val === null) return true;
  if (typeof ruleNode['.validate'] === 'string' && !evaluate(ruleNode['.validate'], ctx, vars)) {
    why.push(`.validate failed at /${parts.join('/')}: ${ruleNode['.validate']}`);
    return false;
  }
  if (val && typeof val === 'object') {
    for (const k of Object.keys(val)) {
      const c = child(ruleNode, k);
      if (c.node && !validateSubtree(c.node, { ...vars, ...c.vars }, oldTree, newTree, parts.concat(k), auth, now, why)) return false;
    }
  }
  return true;
}

// Returns { ok, why } for writing `value` at `parts` as `auth`
function checkWrite(tree, parts, value, auth, now) {
  const newTree = setAt(tree, parts, value);
  let node = RULES;
  let vars = {};
  let allowed = false;
  const why = [];
  for (let i = 0; i <= parts.length; i++) {
    if (node && typeof node['.write'] === 'string') {
      const ctx = { auth, now, root: snapshot(tree, []), data: snapshot(tree, parts.slice(0, i)), newData: snapshot(newTree, parts.slice(0, i)) };
      if (evaluate(node['.write'], ctx, vars)) allowed = true;
      else why.push(`.write false at /${parts.slice(0, i).join('/')}: ${node['.write']}`);
    } else if (node && node['.write'] === true) allowed = true;
    if (i === parts.length) break;
    const c = child(node, parts[i]);
    node = c.node;
    vars = { ...vars, ...c.vars };
    if (!node) break;
  }
  if (!allowed) return { ok: false, why: why.length ? why : [`no .write rule allows /${parts.join('/')}`], newTree };
  // validate the node written and everything beneath it
  let rn = RULES;
  let rv = {};
  for (const p of parts) {
    const c = child(rn, p);
    rn = c.node;
    rv = { ...rv, ...c.vars };
    if (!rn) break;
  }
  const vwhy = [];
  if (rn && !validateSubtree(rn, rv, tree, newTree, parts, auth, now, vwhy)) return { ok: false, why: vwhy, newTree };
  return { ok: true, why: [], newTree };
}

// ---- the database -------------------------------------------------------------------

class RulesDb {
  constructor() {
    this.tree = {};
    this.clock = 1_800_000_000_000;
    this.listeners = [];
    this.denied = []; // every refused read or write, for the test to look at
  }

  now() {
    return (this.clock += 1000);
  }

  // mark TIMESTAMP placeholders with the server's time
  stamp(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return this.now();
      if (Array.isArray(v)) return v.map((x) => this.stamp(x));
      const o = {};
      for (const k of Object.keys(v)) o[k] = this.stamp(v[k]);
      return o;
    }
    return v;
  }

  write(parts, value, auth) {
    const v = this.stamp(value);
    const res = checkWrite(this.tree, parts, v, auth, this.clock);
    if (!res.ok) {
      this.denied.push({ op: 'write', path: '/' + parts.join('/'), auth: auth && auth.uid, why: res.why });
      const err = new Error(`PERMISSION_DENIED: Permission denied (${res.why[0] || ''})`);
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    this.tree = res.newTree;
    this.notify();
  }

  read(parts, auth) {
    if (!allowedRead(this.tree, parts, auth, this.clock)) {
      this.denied.push({ op: 'read', path: '/' + parts.join('/'), auth: auth && auth.uid });
      const err = new Error('PERMISSION_DENIED: Permission denied');
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    return getAt(this.tree, parts);
  }

  notify() {
    for (const l of this.listeners.slice()) {
      let val;
      try {
        val = this.read(l.parts, l.auth);
      } catch (err) {
        continue;
      }
      const json = JSON.stringify(val);
      if (json !== l.last) {
        l.last = json;
        setTimeout(() => l.cb(makeSnap(clone(val), l.parts)), 0);
      }
    }
  }

  // the `firebase` global the app expects, signed in as `uid`
  firebaseFor(uid) {
    const db = this;
    const auth = { uid };
    const makeRef = (parts) => {
      const ref = {
        key: parts[parts.length - 1] || null,
        child: (p) => makeRef(parts.concat(split(p))),
        orderByChild: () => ref,
        limitToLast: () => ref,
        limitToFirst: () => ref,
        endAt: () => ref,
        async get() {
          return makeSnap(clone(db.read(parts, auth)), parts);
        },
        async set(v) {
          db.write(parts, v, auth);
        },
        async update(obj) {
          for (const k of Object.keys(obj)) db.write(parts.concat(split(k)), obj[k], auth);
        },
        async remove() {
          db.write(parts, null, auth);
        },
        async transaction(fn) {
          const cur = clone(db.read(parts, auth));
          const next = fn(cur);
          if (next === undefined) return { committed: false, snapshot: makeSnap(cur, parts) };
          db.write(parts, next, auth);
          return { committed: true, snapshot: makeSnap(clone(getAt(db.tree, parts)), parts) };
        },
        push(v) {
          const id = 'k' + Math.random().toString(36).slice(2, 10);
          const r = makeRef(parts.concat(id));
          const p = v === undefined ? Promise.resolve() : r.set(v);
          return Object.assign(p, { key: id });
        },
        on(event, cb) {
          if (parts[0] === '.info') {
            setTimeout(() => cb(makeSnap(parts[1] === 'connected' ? true : 0, parts)), 0);
            return cb;
          }
          const l = { parts, cb, auth, last: undefined };
          db.listeners.push(l);
          let val;
          try {
            val = db.read(parts, auth);
          } catch (err) {
            return cb;
          }
          l.last = JSON.stringify(val);
          setTimeout(() => cb(makeSnap(clone(val), parts)), 0);
          return cb;
        },
        off(event, cb) {
          db.listeners = db.listeners.filter((l) => l.cb !== cb);
        },
        onDisconnect: () => ({ set: async () => {}, remove: async () => {}, cancel: async () => {} }),
      };
      return ref;
    };
    const database = () => ({ ref: (p) => makeRef(split(p || '')), INTERNAL: { forceWebSockets() {} }, goOnline() {}, goOffline() {} });
    database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
    return {
      initializeApp() {},
      database,
      auth: () => ({
        onAuthStateChanged: (cb) => {
          setTimeout(() => cb({ uid }), 0);
          return () => {};
        },
        signInAnonymously: async () => ({ user: { uid } }),
        currentUser: { uid },
      }),
    };
  }
}

function makeSnap(val, parts) {
  const keys = val && typeof val === 'object' ? Object.keys(val) : [];
  return {
    key: parts[parts.length - 1] || null,
    val: () => val,
    exists: () => val !== null && val !== undefined,
    numChildren: () => keys.length,
    forEach: (fn) => keys.some((k) => fn(makeSnap(val[k], parts.concat(k))) === true),
    child: (p) => makeSnap(getAt(val, split(p)), parts.concat(split(p))),
  };
}

module.exports = { RulesDb, checkWrite, allowedRead, RULES };
