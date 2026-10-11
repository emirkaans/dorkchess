// Generates the app icons (PNG) without image libraries: shapes are computed
// per pixel with 4x4 supersampling and written with Node's zlib.
//   npm run icons   ->  public/icons/*.png
// Design: the logo's crown, drawn as a pink outline on the dark ground, with a lime paint dot.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];

const GROUND: RGBA = [10, 10, 11, 255];
const PINK: RGBA = [255, 46, 147, 255];
const LIME: RGBA = [198, 255, 61, 255];

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

/** The crown outline (the logo's path, 48x40 units) as line segments. */
const CROWN: [number, number][] = [
  [6, 30],
  [4, 8],
  [15, 19],
  [24, 4],
  [33, 19],
  [44, 8],
  [42, 30],
];
const SEGMENTS: [number, number, number, number][] = [
  ...CROWN.map((p, i) => {
    const q = CROWN[(i + 1) % CROWN.length];
    return [p[0], p[1], q[0], q[1]] as [number, number, number, number];
  }),
  [8, 36, 40, 36], // the base line
];

function distToSegment(x: number, y: number, [ax, ay, bx, by]: [number, number, number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Is (x, y) in 0..1 icon space on the crown's stroke? The crown fills the middle 76% of the width. */
function onCrown(x: number, y: number): boolean {
  const scale = 48 / 0.76;
  const cx = (x - 0.12) * scale;
  const cy = (y - 0.5) * scale + 20;
  return SEGMENTS.some((seg) => distToSegment(cx, cy, seg) <= 2.4);
}

/** The lime paint dot at the lower right (a big drop and two small ones). */
function onDot(x: number, y: number): boolean {
  return (
    Math.hypot(x - 0.8, y - 0.8) <= 0.05 ||
    Math.hypot(x - 0.88, y - 0.7) <= 0.018 ||
    Math.hypot(x - 0.72, y - 0.88) <= 0.014
  );
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
          // Drawing space: scaled into the safe zone.
          const pu = 0.5 + (u - 0.5) / (1 - 2 * inset);
          const pv = 0.5 + (v - 0.5) / (1 - 2 * inset);
          let c: RGBA = GROUND;
          if (onDot(pu, pv)) c = LIME;
          if (onCrown(pu, pv)) c = PINK;
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
