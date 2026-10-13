// Copies the game's own rule files into functions/shared, so that the Cloud
// Functions use exactly the code the app runs. Firebase runs this before
// every deploy (see firebase.json); run it by hand with `npm run sync-functions`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = ['engine.js', 'ai.js', 'game.js', 'matchmaking.js', 'arena.js'];
const out = path.join(root, 'functions', 'shared');

fs.mkdirSync(out, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
console.log(`Copied ${FILES.length} files to functions/shared`);
