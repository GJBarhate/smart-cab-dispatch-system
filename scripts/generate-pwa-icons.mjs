// Generates simple solid-colour square PNG icons (no external deps) for PWA manifests.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidPng(size, [r, g, b], letter) {
  const width = size, height = size;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  // simple centred square "letter" mark by darkening a central block, so icons aren't a totally flat blob
  const markStart = Math.floor(width * 0.3);
  const markEnd = Math.floor(width * 0.7);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type none
    for (let x = 0; x < width; x++) {
      const inMark = letter && x >= markStart && x < markEnd && y >= markStart && y < markEnd;
      const px = rowStart + 1 + x * 3;
      if (inMark) {
        raw[px] = 255; raw[px + 1] = 255; raw[px + 2] = 255;
      } else {
        raw[px] = r; raw[px + 1] = g; raw[px + 2] = b;
      }
    }
  }
  const idat = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const targets = [
  { dir: join(__dirname, '..', 'apps', 'guest', 'public'), color: [37, 99, 235] },   // brand-600
  { dir: join(__dirname, '..', 'apps', 'admin', 'public'), color: [109, 40, 217] }   // ops-600
];

for (const { dir, color } of targets) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pwa-192x192.png'), solidPng(192, color, true));
  writeFileSync(join(dir, 'pwa-512x512.png'), solidPng(512, color, true));
  console.log(`generated icons -> ${dir}`);
}
