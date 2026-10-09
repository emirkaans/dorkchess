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

export interface Tables {
  /** [type * 128 + side * 64 + sq] -> value + PST, per phase */
  readonly mg: Int16Array;
  readonly eg: Int16Array;
  readonly phase: Int8Array;
  readonly pawn: number;
  readonly bishop: number;
  readonly rook: number;
  readonly king: number;
  readonly mobilityTypes: readonly { type: number; wm: number; we: number; base: number; ka: number }[];
  /** Types worth threatening with a pawn: capturable, valued, not pawn or royal. */
  readonly threatTypes: readonly number[];
}

const tablesCache = new WeakMap<VariantDefinition, Tables>();
export function tablesFor(b: FastBoard): Tables {
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
    mobilityTypes: ['n', 'b', 'r', 'q']
      .filter((l) => ix(l) >= 0)
      .map((l) => ({
        type: ix(l),
        wm: WEIGHTS.mobility[l][0],
        we: WEIGHTS.mobility[l][1],
        base: WEIGHTS.mobilityBase[l],
        ka: WEIGHTS.kingAttack[l],
      })),
    threatTypes: b.types
      .filter((ty) => !ty.isPawn && !ty.royal && ty.capturable && (b.v.pieceValues[ty.letter] ?? 0) > 0)
      .map((ty) => ty.index),
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
/** Per entry and side: squares attacked by that side's pawns (low / high 32 squares). */
const pcAtt = new Int32Array(PAWN_CACHE * 4);
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
    let lo = 0;
    let hi = 0;
    const fw = side === 0 ? 8 : -8;
    for (let i = b.count(pawn, side as Side) - 1; i >= 0; i--) {
      const s = list[i];
      const to = s + fw;
      if (to < 0 || to > 63) continue;
      for (const t of [(s & 7) > 0 ? to - 1 : -1, (s & 7) < 7 ? to + 1 : -1]) {
        if (t < 0) continue;
        if (t < 32) lo |= 1 << t;
        else hi |= 1 << (t - 32);
      }
    }
    pcAtt[e * 4 + side * 2] = lo;
    pcAtt[e * 4 + side * 2 + 1] = hi;
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

  if (t.pawn >= 0) {
    const threats = pawnThreats(b, t);
    mg += W.threatByPawn[0] * threats;
    eg += W.threatByPawn[1] * threats;
  }

  if (opts.mobility && t.mobilityTypes.length) {
    const ph0 = Math.min(b.phase, MAX_PHASE);
    const cheap = (b.side === 0 ? 1 : -1) * Math.round((mg * ph0 + eg * (MAX_PHASE - ph0)) / MAX_PHASE);
    if (cheap + LAZY_MARGIN > alpha && cheap - LAZY_MARGIN < beta) {
      mobilityTerms(b, t);
      mg += mobMg + attackMg;
      eg += mobEg;
    }
  }

  const ph = Math.min(b.phase, MAX_PHASE);
  let score = Math.round((mg * ph + eg * (MAX_PHASE - ph)) / MAX_PHASE);
  const hook = b.hooks.evaluate;
  if (hook) score += hook(b, 0) - hook(b, 1);
  score = b.side === 0 ? score : -score;
  return score + W.tempo;
}

/** Enemy pieces attacked by a pawn: White's count minus Black's (pawn attack maps come from the pawn cache). */
export function pawnThreats(b: FastBoard, t: Tables): number {
  const e = pawnEntry(b, t.pawn);
  let n = 0;
  const types = t.threatTypes;
  for (let k = 0; k < types.length; k++) {
    const type = types[k];
    for (let side = 0; side < 2; side++) {
      const base = e * 4 + (side ^ 1) * 2;
      const lo = pcAtt[base];
      const hi = pcAtt[base + 1];
      const list = b.squares(type, side as Side);
      for (let i = b.count(type, side as Side) - 1; i >= 0; i--) {
        const s = list[i];
        const hit = s < 32 ? (lo >>> s) & 1 : (hi >>> (s - 32)) & 1;
        if (hit) n += side === 0 ? -1 : 1;
      }
    }
  }
  return n;
}

/** Mobility and king attack totals of the last mobilityTerms call (White's view). */
let mobMg = 0;
let mobEg = 0;
let attackMg = 0;
/** Per side: squares around that side's king (king square and neighbours). */
const ZONE = [new Uint8Array(64), new Uint8Array(64)];
/** Per side and mobility type: king-zone squares attacked (for the tuner's linear form). */
export const attackHits = [new Int32Array(8), new Int32Array(8)];
export const attackers = new Int32Array(2);

function fillZones(b: FastBoard, king: number): void {
  for (let side = 0; side < 2; side++) {
    const z = ZONE[side];
    z.fill(0);
    if (king < 0 || b.count(king, side as Side) !== 1) continue;
    const k = b.squares(king, side as Side)[0];
    const kf = k & 7;
    const kr = k >> 3;
    for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
      for (let r = Math.max(0, kr - 1); r <= Math.min(7, kr + 1); r++) z[r * 8 + f] = 1;
    }
  }
}

/**
 * Sets mobMg / mobEg (reachable squares beyond the type's average, weighted)
 * and attackMg (king attack: attacked squares around the enemy king, weighted
 * by attacker type, scaled by the number of attacking pieces).
 */
function mobilityTerms(b: FastBoard, t: Tables): void {
  const W = WEIGHTS;
  let mg = 0;
  let eg = 0;
  let att = 0;
  fillZones(b, t.king);
  const types = t.mobilityTypes;
  for (let side = 0; side < 2; side++) {
    const enemyZone = ZONE[side ^ 1];
    const hitsByType = attackHits[side];
    let units = 0;
    let count = 0;
    let smg = 0;
    let seg = 0;
    for (let k = 0; k < types.length; k++) {
      const { type, wm, we, base, ka } = types[k];
      const list = b.squares(type, side as Side);
      const n = b.count(type, side as Side);
      let hitsT = 0;
      for (let i = 0; i < n; i++) {
        const r = b.reachZone(list[i], side as Side, enemyZone);
        const m = (r & 255) - base;
        smg += wm * m;
        seg += we * m;
        const hits = r >> 8;
        if (hits) {
          hitsT += hits;
          count++;
        }
      }
      hitsByType[k] = hitsT;
      units += ka * hitsT;
    }
    attackers[side] = count;
    const a = (units * W.kingAttackScale[Math.min(count, 7)]) / 100;
    if (side === 0) {
      mg += smg;
      eg += seg;
      att += a;
    } else {
      mg -= smg;
      eg -= seg;
      att -= a;
    }
  }
  mobMg = mg;
  mobEg = eg;
  attackMg = att;
}

/** Runs the mobility / king attack pass alone (for the tuner's linear form). */
export function mobilityPass(b: FastBoard): void {
  mobilityTerms(b, tablesFor(b));
}

/** Evaluation of an engine position (convenience for tests and tools). */
export function evaluate(v: VariantDefinition, pos: Position, opts: EvalOptions = {}): number {
  return evaluateBoard(new FastBoard(v).load(pos), opts) - WEIGHTS.tempo;
}
