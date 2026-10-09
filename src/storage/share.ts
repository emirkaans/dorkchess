// Shareable links: a game or a position encoded into the URL hash (no backend).
//   #g=<base64url JSON {v, f?, m}>   a game: variant, start FEN (when not the default), SAN moves
//   #p=<base64url JSON {v, f}>       a position: variant and FEN
// Decoding replays and validates everything with the engine. No React / DOM imports.

import { createGame, getVariant, listVariants, parseFen, playSan } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { LocalizedError } from '../i18n/index.ts';

export interface SharedGame {
  readonly variantId: string;
  readonly startFen: string;
  readonly moves: readonly string[];
}

export type SharedLink =
  | { readonly kind: 'game'; readonly game: SharedGame; readonly states: readonly GameState[] }
  | { readonly kind: 'position'; readonly variantId: string; readonly fen: string };

// --- base64url of UTF-8 text (works in browsers, workers and Node) ---

/** Globals used here, typed locally: this folder is type-checked without the DOM lib. */
const web = globalThis as unknown as {
  btoa(s: string): string;
  atob(s: string): string;
  TextEncoder: new () => { encode(s: string): Uint8Array };
  TextDecoder: new () => { decode(b: Uint8Array): string };
};

function toBase64Url(text: string): string {
  const bytes = new web.TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return web.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = web.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new web.TextDecoder().decode(Uint8Array.from(bin, (c: string) => c.charCodeAt(0)));
}

export function encodeGame(g: SharedGame): string {
  const v = getVariant(g.variantId);
  const data: { v: string; f?: string; m: string } = { v: g.variantId, m: g.moves.join(' ') };
  if (g.startFen !== v.startPosition) data.f = g.startFen;
  return `#g=${toBase64Url(JSON.stringify(data))}`;
}

export function encodePosition(variantId: string, fen: string): string {
  return `#p=${toBase64Url(JSON.stringify({ v: variantId, f: fen }))}`;
}

/**
 * Reads a link's hash. Returns null when the hash holds no shared content;
 * throws a LocalizedError when it does but is broken or illegal.
 */
export function decodeLink(hash: string): SharedLink | null {
  const m = /^#?([gp])=(.+)$/.exec(hash);
  if (!m) return null;
  let data: { v?: unknown; f?: unknown; m?: unknown };
  try {
    data = JSON.parse(fromBase64Url(m[2]));
  } catch {
    throw new LocalizedError('error.broken');
  }
  const variantId = typeof data.v === 'string' ? data.v : '';
  if (!listVariants().some((x) => x.id === variantId))
    throw new LocalizedError('error.unknownVariant', { id: variantId || '?' });
  const v = getVariant(variantId);

  if (m[1] === 'p') {
    const fen = typeof data.f === 'string' ? data.f : '';
    try {
      parseFen(v, fen);
    } catch {
      throw new LocalizedError('error.linkPosition');
    }
    return { kind: 'position', variantId, fen };
  }

  const startFen = typeof data.f === 'string' ? data.f : v.startPosition;
  const moves = typeof data.m === 'string' && data.m.trim() ? data.m.trim().split(/\s+/) : [];
  let state: GameState;
  try {
    state = createGame(v, startFen);
  } catch {
    throw new LocalizedError('error.linkStart');
  }
  const states = [state];
  for (const san of moves) {
    try {
      state = playSan(v, state, san);
    } catch {
      throw new LocalizedError('error.linkMove', { san });
    }
    states.push(state);
  }
  return { kind: 'game', game: { variantId, startFen, moves }, states };
}
