import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const outDir = path.resolve('public');

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

function setPixel(buf, size, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const idx = (y * size + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function fillRect(buf, size, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) setPixel(buf, size, px, py, ...color);
  }
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cell = Math.max(1, Math.floor(size / 32));
  fillRect(rgba, size, 0, 0, size, size, [3, 8, 8, 255]);
  fillRect(rgba, size, cell * 3, cell * 3, size - cell * 6, size - cell * 6, [10, 18, 17, 255]);
  fillRect(rgba, size, cell * 5, cell * 5, size - cell * 10, cell * 3, [130, 15, 14, 255]);
  fillRect(rgba, size, cell * 5, size - cell * 8, size - cell * 10, cell * 3, [130, 15, 14, 255]);
  fillRect(rgba, size, cell * 5, cell * 8, cell * 3, size - cell * 16, [18, 170, 160, 255]);
  fillRect(rgba, size, size - cell * 8, cell * 8, cell * 3, size - cell * 16, [18, 170, 160, 255]);
  fillRect(rgba, size, cell * 11, cell * 12, cell * 10, cell * 3, [220, 210, 140, 255]);
  fillRect(rgba, size, cell * 11, cell * 15, cell * 3, cell * 8, [220, 210, 140, 255]);
  fillRect(rgba, size, cell * 19, cell * 15, cell * 3, cell * 8, [220, 210, 140, 255]);
  fillRect(rgba, size, cell * 11, cell * 23, cell * 11, cell * 3, [220, 210, 140, 255]);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'icon-192.png'), makeIcon(192));
await writeFile(path.join(outDir, 'icon-512.png'), makeIcon(512));
await writeFile(path.join(outDir, 'apple-touch-icon.png'), makeIcon(180));
