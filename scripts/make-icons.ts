// Generates the app icons (PNG) without image libraries: shapes are computed
// per pixel with 4x4 supersampling and written with Node's zlib.
//   npm run icons   ->  public/icons/*.png
// Design: a 4x4 board in the app's colours with a white pawn in the middle.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];

const LIGHT: RGBA = [238, 218, 181, 255];
const DARK: RGBA = [181, 136, 99, 255];
const PAWN: RGBA = [250, 250, 250, 255];
const INK: RGBA = [34, 34, 34, 255];

// --- PNG writer -------------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// --- drawing (coordinates in 0..1) ------------------------------------------

/** Signed-ish shape tests for the pawn: head circle, body (trapezoid), base. */
function inPawn(x: number, y: number, grow: number): boolean {
  const cx = 0.5;
  const head = Math.hypot(x - cx, y - 0.34) <= 0.11 + grow;
  // Body: widens from 0.07 (top, y=0.42) to 0.17 (bottom, y=0.66).
  const t = (y - 0.42) / 0.24;
  const half = 0.07 + 0.1 * t;
  const body = y >= 0.42 - grow && y <= 0.66 + grow && Math.abs(x - cx) <= half + grow;
  const base = y >= 0.64 - grow && y <= 0.74 + grow && Math.abs(x - cx) <= 0.22 + grow;
  return head || body || base;
}

/**
 * One icon. `inset` shrinks the drawing towards the centre (maskable icons keep
 * their content inside the safe zone); `round` is the corner radius (0 = square).
 */
function draw(size: number, inset: number, round: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (x + (sx + 0.5) / S) / size;
          const v = (y + (sy + 0.5) / S) / size;
          // Rounded-square mask of the whole icon.
          const dx = Math.max(Math.abs(u - 0.5) - (0.5 - round), 0);
          const dy = Math.max(Math.abs(v - 0.5) - (0.5 - round), 0);
          if (round > 0 && Math.hypot(dx, dy) > round) continue;
          // Pawn space: scaled into the safe zone.
          const pu = 0.5 + (u - 0.5) / (1 - 2 * inset);
          const pv = 0.5 + (v - 0.5) / (1 - 2 * inset);
          let c: RGBA = (Math.floor(u * 4) + Math.floor(v * 4)) % 2 === 0 ? LIGHT : DARK;
          if (inPawn(pu, pv, 0.022)) c = INK;
          if (inPawn(pu, pv, 0)) c = PAWN;
          for (let k = 0; k < 4; k++) acc[k] += c[k];
        }
      }
      for (let k = 0; k < 4; k++) px[(y * size + x) * 4 + k] = Math.round(acc[k] / (S * S));
    }
  }
  return px;
}

mkdirSync('public/icons', { recursive: true });
const icons: [string, number, number, number][] = [
  ['icon-192.png', 192, 0.06, 0.18],
  ['icon-512.png', 512, 0.06, 0.18],
  ['maskable-512.png', 512, 0.16, 0], // full-bleed; content within the 80% safe circle
  ['apple-touch-icon.png', 180, 0.08, 0],
];
for (const [name, size, inset, round] of icons) {
  writeFileSync(`public/icons/${name}`, png(size, draw(size, inset, round)));
  console.log(`public/icons/${name}`);
}
