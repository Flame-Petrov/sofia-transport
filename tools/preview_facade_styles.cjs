// Render every façade style in several tints as a PNG contact sheet.
// Usage: node tools/preview_facade_styles.cjs [output.png]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const context = vm.createContext({
  ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/features/view3d/facade-styles.js'), 'utf8'), context);
const { styles, images } = context.facadeStyles;

const BAYS = 5, FLOORS = 5, CELL = 64, GAP = 16, TINTS = 4;
const tileW = BAYS * CELL, tileH = FLOORS * CELL;
const width = GAP + TINTS * (tileW + GAP), height = GAP + styles.length * (tileH + GAP);
const pixels = Buffer.alloc(width * height * 3, 246);

styles.forEach((style, row) => {
  const set = images(row);
  for (let column = 0; column < TINTS; column++) {
    const tint = style.tints[Math.floor(column * style.tints.length / TINTS)];
    const left = GAP + column * (tileW + GAP), top = GAP + row * (tileH + GAP);
    for (let y = 0; y < tileH; y++) {
      const level = Math.floor(y / CELL);
      const image = level === 0 ? set.ground : level === FLOORS - 1 ? set.crown : set.middle;
      for (let x = 0; x < tileW; x++) {
        // The same per-window variation as the wall shader.
        const n = Math.abs(Math.sin((Math.floor(x / CELL) + column * 3.7) * 12.9898 + level * 78.233) * 43758.5453) % 1;
        const o = ((y % image.height) * image.width + (x + column * CELL) % image.width) * 4, a = image.data[o + 3] / 255;
        const at = ((top + tileH - 1 - y) * width + left + x) * 3;
        for (let c = 0; c < 3; c++) {
          const fixed = image.data[o + c] * (0.8 + 0.4 * n), wall = image.data[o + c] * tint[c] / 255;
          pixels[at + c] = Math.min(255, fixed * (1 - a) + wall * a);
        }
      }
    }
  }
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const rows = Buffer.alloc(height * (width * 3 + 1));
for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
const output = process.argv[2] || path.join(__dirname, '../models/facade-styles.png');
fs.writeFileSync(output, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
console.log(output, width + ' x ' + height, styles.map(s => s.name).join(', '));
