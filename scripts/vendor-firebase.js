// Copies the Firebase browser bundles the game loads as plain <script> tags
// (the renderer has no bundler and its content policy allows local files only).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'firebase');
const dest = path.join(__dirname, '..', 'vendor', 'firebase');
fs.mkdirSync(dest, { recursive: true });
for (const name of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
const version = require(path.join(src, 'package.json')).version;
fs.writeFileSync(path.join(dest, 'VERSION'), version + '\n');
console.log('vendored firebase ' + version);
