// Estimates how likely a player is to have made the first 30-point meld by
// their first, second and third turn, by dealing many random hands and asking
// the solver. A player who cannot meld draws one tile and tries again.
//
//   node scripts/meld-odds.js [hands]
//
// The result is pasted into FIRST_MELD_ODDS in src/ui.js.
const { createTiles, shuffle } = require('../src/engine.js');
const { computeMove } = require('../src/ai.js');

const hands = Number(process.argv[2]) || 40000;
let s = 12345;
const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const by = [0, 0, 0];
for (let n = 0; n < hands; n++) {
  const tiles = shuffle(createTiles(), rng);
  const rack = tiles.splice(0, 14);
  for (let turn = 0; turn < 3; turn++) {
    if (computeMove({ tableSets: [], rack, melded: false }).type === 'play') {
      for (let t = turn; t < 3; t++) by[t]++;
      break;
    }
    rack.push(tiles.pop());
  }
}
console.log(by.map((c, i) => `by turn ${i + 1}: ${((100 * c) / hands).toFixed(1)}%`).join('\n'));
