// Static evaluation on the fast board. Variant-independent apart from the
// optional hooks in the variant definition (pieceValues, fast.evaluate).
// No React / DOM imports.

import { FastBoard } from '../engine/fast/board.ts';
import type { Side } from '../engine/fast/hooks.ts';
import type { Position, VariantDefinition } from '../engine/index.ts';
import { EVAL_PARAMS } from './eval-params.ts';

/** The parameters currently in use (the tuner swaps them while it evaluates). */
export const WEIGHTS = EVAL_PARAMS;

/** Score for being mated; the search subtracts the ply so shorter mates score higher. */
export const MATE = 100000;
/** Scores beyond this are mate scores. */
export const MATE_BOUND = MATE - 1000;

/** Game phase weight of a piece: minor 1, rook 2, queen 4; special pieces by value. */
export const phaseWeight = (letter: string, value: number) =>
  letter === 'p' || letter === 'k' ? 0 : Math.max(0, Math.min(4, Math.round(value / 250)));
const MAX_PHASE = 24;

interface Tables {
  /** [type * 128 + side * 64 + sq] -> value + PST, per phase */
  readonly mg: Int16Array;
  readonly eg: Int16Array;
  readonly phase: Int8Array;
  readonly pawn: number;
  readonly bishop: number;
  readonly rook: number;
  readonly king: number;
  readonly mobilityTypes: readonly { type: number; letter: string }[];
}

const tablesCache = new WeakMap<VariantDefinition, Tables>();
function tablesFor(b: FastBoard): Tables {
  let t = tablesCache.get(b.v);
  if (t) return t;
  const n = b.types.length;
  const mg = new Int16Array(n * 128);
  const eg = new Int16Array(n * 128);
  const phase = new Int8Array(n);
  for (const type of b.types) {
    const value = b.v.pieceValues[type.letter] ?? 0;
    phase[type.index] = phaseWeight(type.letter, value);
    for (let side = 0; side < 2; side++) {
      for (let sq = 0; sq < 64; sq++) {
        // Tables are from White's view with rank 8 first; Black mirrors vertically.
        const idx = side === 0 ? (7 - (sq >> 3)) * 8 + (sq & 7) : (sq >> 3) * 8 + (sq & 7);
        mg[type.index * 128 + side * 64 + sq] = value + (WEIGHTS.pstMg[type.letter]?.[idx] ?? 0);
        eg[type.index * 128 + side * 64 + sq] = value + (WEIGHTS.pstEg[type.letter]?.[idx] ?? 0);
      }
    }
  }
  const ix = (l: string) => b.typeIndex.get(l) ?? -1;
  t = {
    mg,
    eg,
    phase,
    pawn: ix('p'),
    bishop: ix('b'),
    rook: ix('r'),
    king: ix('k'),
    mobilityTypes: ['n', 'b', 'r', 'q'].filter((l) => ix(l) >= 0).map((l) => ({ type: ix(l), letter: l })),
  };
  tablesCache.set(b.v, t);
  return t;
}

// Pawn structure cache, keyed by the board's pawn-only Zobrist key.
const PAWN_CACHE = 1 << 14;
const pcKey = new Int32Array(PAWN_CACHE);
const pcUsed = new Uint8Array(PAWN_CACHE);
const pcMg = new Int16Array(PAWN_CACHE);
const pcEg = new Int16Array(PAWN_CACHE);
/** Per entry and side: bitmask of files with pawns. */
const pcFiles = new Uint8Array(PAWN_CACHE * 2);
/** Per entry, side and file: lowest / highest pawn rank (8 / -1 when none). */
const pcMin = new Int8Array(PAWN_CACHE * 16);
const pcMax = new Int8Array(PAWN_CACHE * 16);
let pcVariant: VariantDefinition | null = null;

/** Fills (or finds) the pawn cache entry of the current pawn structure; returns its index. */
function pawnEntry(b: FastBoard, pawn: number): number {
  if (pcVariant !== b.v) {
    pcUsed.fill(0);
    pcVariant = b.v;
  }
  const key = b.pawnKey;
  const e = key & (PAWN_CACHE - 1);
  if (pcUsed[e] && pcKey[e] === key) return e;
  const W = WEIGHTS;
  let mg = 0;
  let eg = 0;
  for (let side = 0; side < 2; side++) {
    let files = 0;
    for (let f = 0; f < 8; f++) {
      pcMin[e * 16 + side * 8 + f] = 8;
      pcMax[e * 16 + side * 8 + f] = -1;
    }
    const list = b.squares(pawn, side as Side);
    for (let i = b.count(pawn, side as Side) - 1; i >= 0; i--) {
      const f = list[i] & 7;
      const r = list[i] >> 3;
      files |= 1 << f;
      const k = e * 16 + side * 8 + f;
      if (r < pcMin[k]) pcMin[k] = r;
      if (r > pcMax[k]) pcMax[k] = r;
    }
    pcFiles[e * 2 + side] = files;
  }
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    const other = side ^ 1;
    const files = pcFiles[e * 2 + side];
    const list = b.squares(pawn, side as Side);
    const count = b.count(pawn, side as Side);
    // Doubled pawns: pawns beyond the first on a file.
    let perFile = 0;
    for (let f = 0; f < 8; f++) {
      if (!((files >> f) & 1)) continue;
      let n = 0;
      for (let i = 0; i < count; i++) if ((list[i] & 7) === f) n++;
      perFile += n - 1;
      const isolated = !(f > 0 && (files >> (f - 1)) & 1) && !(f < 7 && (files >> (f + 1)) & 1);
      if (isolated) {
        mg += sign * W.isolatedPawn[0] * n;
        eg += sign * W.isolatedPawn[1] * n;
      }
    }
    mg += sign * W.doubledPawn[0] * perFile;
    eg += sign * W.doubledPawn[1] * perFile;
    // Passed pawns: no enemy pawn ahead on this or an adjacent file.
    for (let i = 0; i < count; i++) {
      const s = list[i];
      const f = s & 7;
      const r = s >> 3;
      let passed = true;
      for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1) && passed; ff++) {
        const k = e * 16 + other * 8 + ff;
        if (side === 0 ? pcMax[k] > r : pcMin[k] < 8 && pcMin[k] < r) passed = false;
      }
      if (passed) {
        const rel = side === 0 ? r : 7 - r;
        mg += sign * W.passedMg[rel];
        eg += sign * W.passedEg[rel];
      }
    }
  }
  pcKey[e] = key;
  pcUsed[e] = 1;
  pcMg[e] = mg;
  pcEg[e] = eg;
  return e;
}

const initialised = new WeakSet<FastBoard>();

export interface EvalOptions {
  readonly mobility?: boolean;
}

/** Mobility rarely moves the score by more than this; beyond it the cheap score decides (lazy evaluation). */
const LAZY_MARGIN = 80;

/**
 * Static evaluation in centipawns from the side to move's point of view.
 * With `alpha`/`beta`, the (expensive) mobility term is skipped when the
 * score without it is already clearly outside the bounds.
 */
export function evaluateBoard(b: FastBoard, opts: EvalOptions = {}, alpha = -Infinity, beta = Infinity): number {
  const t = tablesFor(b);
  if (!initialised.has(b)) {
    b.useEval(t.mg, t.eg, t.phase);
    initialised.add(b);
  }
  const W = WEIGHTS;
  let mg = b.mg;
  let eg = b.eg;

  if (t.bishop >= 0) {
    if (b.count(t.bishop, 0) >= 2) {
      mg += W.bishopPair[0];
      eg += W.bishopPair[1];
    }
    if (b.count(t.bishop, 1) >= 2) {
      mg -= W.bishopPair[0];
      eg -= W.bishopPair[1];
    }
  }

  if (t.pawn >= 0) {
    const e = pawnEntry(b, t.pawn);
    mg += pcMg[e];
    eg += pcEg[e];
    // Rooks on open / semi-open files
    if (t.rook >= 0) {
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const own = pcFiles[e * 2 + side];
        const enemy = pcFiles[e * 2 + (side ^ 1)];
        const list = b.squares(t.rook, side as Side);
        for (let i = b.count(t.rook, side as Side) - 1; i >= 0; i--) {
          const f = list[i] & 7;
          if ((own >> f) & 1) continue;
          const open = !((enemy >> f) & 1);
          mg += sign * (open ? W.rookOpenFile[0] : W.rookSemiOpenFile[0]);
          eg += sign * (open ? W.rookOpenFile[1] : W.rookSemiOpenFile[1]);
        }
      }
    }
    // Pawn shield in front of a king on its back two ranks (mid-game)
    if (t.king >= 0) {
      for (let side = 0; side < 2; side++) {
        if (b.count(t.king, side as Side) !== 1) continue;
        const k = b.squares(t.king, side as Side)[0];
        const r = k >> 3;
        if (side === 0 ? r > 1 : r < 6) continue;
        const f = k & 7;
        let missing = 0;
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
          const idx = e * 16 + side * 8 + ff;
          const shielded = side === 0 ? pcMin[idx] > r && pcMin[idx] <= r + 2 : pcMax[idx] >= 0 && pcMax[idx] < r && pcMax[idx] >= r - 2;
          if (!shielded) missing++;
        }
        mg += (side === 0 ? 1 : -1) * W.kingShieldMissing * missing;
      }
    }
  }

  if (opts.mobility && t.mobilityTypes.length) {
    const ph0 = Math.min(b.phase, MAX_PHASE);
    const cheap = (b.side === 0 ? 1 : -1) * Math.round((mg * ph0 + eg * (MAX_PHASE - ph0)) / MAX_PHASE);
    if (cheap + LAZY_MARGIN > alpha && cheap - LAZY_MARGIN < beta) mobilityTerms(b, t, (dm, de) => {
      mg += dm;
      eg += de;
    });
  }

  const ph = Math.min(b.phase, MAX_PHASE);
  let score = Math.round((mg * ph + eg * (MAX_PHASE - ph)) / MAX_PHASE);
  const hook = b.hooks.evaluate;
  if (hook) score += hook(b, 0) - hook(b, 1);
  score = b.side === 0 ? score : -score;
  return score + W.tempo;
}

function mobilityTerms(b: FastBoard, t: Tables, add: (mg: number, eg: number) => void): void {
  const W = WEIGHTS;
  {
    for (const { type, letter } of t.mobilityTypes) {
      const [wm, we] = W.mobility[letter];
      const base = W.mobilityBase[letter];
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const list = b.squares(type, side as Side);
        for (let i = b.count(type, side as Side) - 1; i >= 0; i--) {
          const m = b.reachCount(list[i], side as Side) - base;
          add(sign * wm * m, sign * we * m);
        }
      }
    }
  }
}

/** Evaluation of an engine position (convenience for tests and tools). */
export function evaluate(v: VariantDefinition, pos: Position, opts: EvalOptions = {}): number {
  return evaluateBoard(new FastBoard(v).load(pos), opts) - WEIGHTS.tempo;
}
