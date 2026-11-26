'use strict';
// Generates the cat-head icon with no dependencies:
//   src/renderer/tray.png   32x32, the tray icon
//   build/icon.ico          16 to 256 px frames, the app and installer icon (electron-builder)
//   build/icon.png          256x256 copy, for anything that wants a PNG
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ORANGE = [242, 184, 114];
const INK = [59, 42, 30];
const PINK = [244, 166, 160];

/** The colour at a point of the 32 x 32 design (integer coordinates are pixel centres), or null for "nothing here". */
function colourAt(x, y) {
  const inEye = ((x >= 10.5 && x < 12.5) || (x >= 19.5 && x < 21.5)) && y >= 16.5 && y < 18.5;
  if (inEye) return INK;
  const inNose = (y >= 20.5 && y < 21.5 && x >= 14.5 && x < 17.5) || (y >= 21.5 && y < 22.5 && x >= 15.5 && x < 16.5);
  if (inNose) return PINK;
  const dx = (x - 16) / 12.5;
  const dy = (y - 18) / 11;
  if (dx * dx + dy * dy <= 1) return ORANGE;
  const ear = (cx) => y >= 3 && y <= 12 && Math.abs(x - cx) <= (y - 3) * 0.7 + 0.5 && Math.abs(x - cx) <= 5;
  return ear(8) || ear(24) ? ORANGE : null;
}

/** RGBA pixels of the design at n x n, averaging ss x ss samples per pixel (ss 1 is the crisp 32 px tray icon). */
function render(n, ss) {
  const px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const c = colourAt(((x + (i + 0.5) / ss) * 32) / n - 0.5, ((y + (j + 0.5) / ss) * 32) / n - 0.5);
          if (c) { r += c[0]; g += c[1]; b += c[2]; hits++; }
        }
      }
      const o = (y * n + x) * 4;
      if (hits) {
        px[o] = Math.round(r / hits); px[o + 1] = Math.round(g / hits); px[o + 2] = Math.round(b / hits);
        px[o + 3] = Math.round((255 * hits) / (ss * ss));
      }
    }
  }
  return px;
}

// PNG encode
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
function encodePng(n, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An .ico holding one PNG frame per size (PNG frames are fine for Windows Vista and later). */
function encodeIco(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.png)]);
}

const root = path.join(__dirname, '..');
const write = (rel, data) => {
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  console.log('wrote', out, data.length, 'bytes');
};

write(path.join('src', 'renderer', 'tray.png'), encodePng(32, render(32, 1)));
const frames = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: encodePng(size, render(size, 4)) }));
write(path.join('build', 'icon.ico'), encodeIco(frames));
write(path.join('build', 'icon.png'), frames[frames.length - 1].png);
