// Wraps a PNG (256×256 or smaller) in a Windows .ico container.
//   node scripts/make-ico.js in.png out.ico
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const png = fs.readFileSync(input);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width > 256 || height > 256) throw new Error('The icon image must be at most 256 pixels square.');
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // an icon
header.writeUInt16LE(1, 4); // one image
const entry = Buffer.alloc(16);
entry.writeUInt8(width === 256 ? 0 : width, 0);
entry.writeUInt8(height === 256 ? 0 : height, 1);
entry.writeUInt16LE(1, 4); // colour planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // where the image starts
fs.writeFileSync(output, Buffer.concat([header, entry, png]));
