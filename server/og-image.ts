// Link preview images (Open Graph): a 1200x630 PNG with the game's board on
// the punkchess frame. The frame and the piece pictures are drawn ahead of
// time (scripts/make-og-assets.ts -> server/og-assets.ts); here they are only
// put together, so it runs in a Worker without any image library.
// Uses CompressionStream / DecompressionStream (Workers, browsers, Node 18+).

export const OG_W = 1200;
export const OG_H = 630;
/** Square size and the board's top-left corner on the image. */
export const SQ = 66;
export const BOARD_X = 51;
export const BOARD_Y = (OG_H - 8 * SQ) / 2;

const LIGHT = [0xd6, 0xd0, 0xc3];
const DARK = [0x1c, 0x1c, 0x1f];
const LAST = [0xff, 0x2e, 0x93];

export interface OgAssets {
  /** The frame, RGB, OG_W x OG_H. */
  readonly frame: Uint8Array;
  /** Piece pictures by colour + type ('wp', 'bq', 'wu', …), RGBA, SQ x SQ. */
  readonly sprites: Readonly<Record<string, Uint8Array>>;
}

export interface OgPiece {
  readonly type: string;
  readonly color: 'w' | 'b';
}

async function pump(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const deflate = (data: Uint8Array) => pump(data, new CompressionStream('deflate'));
export const inflate = (data: Uint8Array) => pump(data, new DecompressionStream('deflate'));

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decodes the packed assets (base64 of deflated pixels). */
export async function unpackAssets(frame: string, sprites: Readonly<Record<string, string>>): Promise<OgAssets> {
  const entries = await Promise.all(
    Object.entries(sprites).map(async ([k, v]) => [k, await inflate(fromBase64(v))] as const),
  );
  return { frame: await inflate(fromBase64(frame)), sprites: Object.fromEntries(entries) };
}

/**
 * The image's pixels (RGB): frame, board (White at the bottom), the last move
 * tinted pink, and the pieces. `board[sq]` uses the engine's numbering (a1 = 0).
 */
export function composeBoard(
  assets: OgAssets,
  board: readonly (OgPiece | null)[],
  lastMove: { from: number; to: number } | null,
): Uint8Array {
  const px = assets.frame.slice();
  for (let sq = 0; sq < 64; sq++) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    const x0 = BOARD_X + file * SQ;
    const y0 = BOARD_Y + (7 - rank) * SQ;
    const base = (file + rank) % 2 === 1 ? LIGHT : DARK;
    const lit = lastMove && (lastMove.from === sq || lastMove.to === sq);
    const color = lit ? base.map((c, i) => Math.round(c * 0.62 + LAST[i] * 0.38)) : base;
    for (let y = 0; y < SQ; y++) {
      let o = ((y0 + y) * OG_W + x0) * 3;
      for (let x = 0; x < SQ; x++, o += 3) {
        px[o] = color[0];
        px[o + 1] = color[1];
        px[o + 2] = color[2];
      }
    }
    const piece = board[sq];
    const sprite = piece && assets.sprites[piece.color + piece.type];
    if (!sprite) continue;
    for (let y = 0; y < SQ; y++) {
      let o = ((y0 + y) * OG_W + x0) * 3;
      let s = y * SQ * 4;
      for (let x = 0; x < SQ; x++, o += 3, s += 4) {
        const a = sprite[s + 3] / 255;
        if (a === 0) continue;
        px[o] = Math.round(sprite[s] * a + px[o] * (1 - a));
        px[o + 1] = Math.round(sprite[s + 1] * a + px[o + 1] * (1 - a));
        px[o + 2] = Math.round(sprite[s + 2] * a + px[o + 2] * (1 - a));
      }
    }
  }
  return px;
}

// --- PNG writer (RGB, no filtering) ---

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

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(rgb: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
