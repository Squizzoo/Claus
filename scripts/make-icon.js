'use strict';
// Generates src/renderer/tray.png (32x32 orange cat head) with no dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 32;
const px = Buffer.alloc(N * N * 4); // RGBA, transparent
const set = (x, y, [r, g, b, a = 255]) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};
const ORANGE = [242, 184, 114];
const INK = [59, 42, 30];
const PINK = [244, 166, 160];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = (x - 16) / 12.5, dy = (y - 18) / 11;
    if (dx * dx + dy * dy <= 1) set(x, y, ORANGE);
    // ears: two triangles
    const ear = (cx) => y >= 3 && y <= 12 && Math.abs(x - cx) <= (y - 3) * 0.7 + 0.5 && Math.abs(x - cx) <= 5;
    if (ear(8) || ear(24)) set(x, y, ORANGE);
  }
}
for (const [x, y] of [[11, 17], [11, 18], [21, 17], [21, 18], [12, 17], [12, 18], [20, 17], [20, 18]]) set(x, y, INK);
for (const [x, y] of [[15, 21], [16, 21], [17, 21], [16, 22]]) set(x, y, PINK);

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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'src', 'renderer', 'tray.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
