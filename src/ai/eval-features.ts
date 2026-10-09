// The evaluation written as a linear function of its parameters, for tuning
// (scripts/tune.ts). Mirrors evaluateBoard term by term; a test keeps the two
// in agreement. No React / DOM imports.

import type { FastBoard } from '../engine/fast/board.ts';
import type { Side } from '../engine/fast/hooks.ts';
import type { EvalParams } from './eval-params.ts';

export const PST_LETTERS = ['p', 'n', 'b', 'r', 'q', 'k'] as const;
const MOB_LETTERS = ['n', 'b', 'r', 'q'] as const;

// Parameter layout of the vector form.
const PST = 0; // (letterIndex * 2 + phase) * 64 + tableIndex
const BISHOP_PAIR = 768;
const DOUBLED = 770;
const ISOLATED = 772;
const PASSED_MG = 774;
const PASSED_EG = 782;
const ROOK_OPEN = 790;
const ROOK_SEMI = 792;
const MOBILITY = 794; // + mobLetterIndex * 2 + phase
const KING_SHIELD = 802;
const TEMPO = 803;
export const PARAM_COUNT = 804;

/** Parameters that never occur and stay fixed (pawn table rows of ranks 1 and 8). */
export function isFrozen(i: number): boolean {
  if (i >= 128) return false;
  const idx = i % 64;
  return idx < 8 || idx >= 56;
}

export function toVector(p: EvalParams): Float64Array {
  const v = new Float64Array(PARAM_COUNT);
  PST_LETTERS.forEach((l, li) => {
    for (let i = 0; i < 64; i++) {
      v[PST + (li * 2) * 64 + i] = p.pstMg[l][i];
      v[PST + (li * 2 + 1) * 64 + i] = p.pstEg[l][i];
    }
  });
  [v[BISHOP_PAIR], v[BISHOP_PAIR + 1]] = p.bishopPair;
  [v[DOUBLED], v[DOUBLED + 1]] = p.doubledPawn;
  [v[ISOLATED], v[ISOLATED + 1]] = p.isolatedPawn;
  for (let r = 0; r < 8; r++) {
    v[PASSED_MG + r] = p.passedMg[r];
    v[PASSED_EG + r] = p.passedEg[r];
  }
  [v[ROOK_OPEN], v[ROOK_OPEN + 1]] = p.rookOpenFile;
  [v[ROOK_SEMI], v[ROOK_SEMI + 1]] = p.rookSemiOpenFile;
  MOB_LETTERS.forEach((l, i) => ([v[MOBILITY + i * 2], v[MOBILITY + i * 2 + 1]] = p.mobility[l]));
  v[KING_SHIELD] = p.kingShieldMissing;
  v[TEMPO] = p.tempo;
  return v;
}

export function fromVector(v: Float64Array, base: EvalParams): EvalParams {
  const r = (x: number) => Math.round(x);
  const pair = (i: number): [number, number] => [r(v[i]), r(v[i + 1])];
  return {
    ...base,
    tempo: r(v[TEMPO]),
    bishopPair: pair(BISHOP_PAIR),
    doubledPawn: pair(DOUBLED),
    isolatedPawn: pair(ISOLATED),
    passedMg: Array.from({ length: 8 }, (_, i) => r(v[PASSED_MG + i])),
    passedEg: Array.from({ length: 8 }, (_, i) => r(v[PASSED_EG + i])),
    rookOpenFile: pair(ROOK_OPEN),
    rookSemiOpenFile: pair(ROOK_SEMI),
    mobility: Object.fromEntries(MOB_LETTERS.map((l, i) => [l, pair(MOBILITY + i * 2)])),
    kingShieldMissing: r(v[KING_SHIELD]),
    pstMg: Object.fromEntries(PST_LETTERS.map((l, li) => [l, Array.from({ length: 64 }, (_, i) => r(v[PST + li * 2 * 64 + i]))])),
    pstEg: Object.fromEntries(PST_LETTERS.map((l, li) => [l, Array.from({ length: 64 }, (_, i) => r(v[PST + (li * 2 + 1) * 64 + i]))])),
  };
}

export interface Features {
  readonly index: number[];
  readonly coef: number[];
  /** Material and variant terms that are not tuned. */
  constant: number;
}

const MAX_PHASE = 24;

/**
 * White-view evaluation as constant + Σ coef[k] * param[index[k]] (mobility
 * always included, no lazy cut-off, no rounding).
 */
export function features(b: FastBoard, p: EvalParams, phaseWeight: (letter: string, value: number) => number): Features {
  const f: Features = { index: [], coef: [], constant: 0 };
  const add = (i: number, c: number) => {
    if (c === 0) return;
    f.index.push(i);
    f.coef.push(c);
  };
  let phase = 0;
  for (const t of b.types) {
    const value = b.v.pieceValues[t.letter] ?? 0;
    phase += phaseWeight(t.letter, value) * (b.count(t.index, 0) + b.count(t.index, 1));
  }
  const ph = Math.min(phase, MAX_PHASE);
  const fm = ph / MAX_PHASE;
  const fe = 1 - fm;
  const ix = (l: string) => b.typeIndex.get(l) ?? -1;

  for (const t of b.types) {
    const value = b.v.pieceValues[t.letter] ?? 0;
    const li = (PST_LETTERS as readonly string[]).indexOf(t.letter);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const list = b.squares(t.index, side as Side);
      for (let i = b.count(t.index, side as Side) - 1; i >= 0; i--) {
        const sq = list[i];
        f.constant += sign * value;
        if (li < 0) continue;
        const idx = side === 0 ? (7 - (sq >> 3)) * 8 + (sq & 7) : (sq >> 3) * 8 + (sq & 7);
        add(PST + li * 2 * 64 + idx, sign * fm);
        add(PST + (li * 2 + 1) * 64 + idx, sign * fe);
      }
    }
  }

  const bishop = ix('b');
  if (bishop >= 0) {
    for (let side = 0; side < 2; side++) {
      if (b.count(bishop, side as Side) < 2) continue;
      const sign = side === 0 ? 1 : -1;
      add(BISHOP_PAIR, sign * fm);
      add(BISHOP_PAIR + 1, sign * fe);
    }
  }

  const pawn = ix('p');
  if (pawn >= 0) {
    const files = [0, 0];
    const min = [new Int8Array(8).fill(8), new Int8Array(8).fill(8)];
    const max = [new Int8Array(8).fill(-1), new Int8Array(8).fill(-1)];
    for (let side = 0; side < 2; side++) {
      const list = b.squares(pawn, side as Side);
      for (let i = b.count(pawn, side as Side) - 1; i >= 0; i--) {
        const fl = list[i] & 7;
        const r = list[i] >> 3;
        files[side] |= 1 << fl;
        min[side][fl] = Math.min(min[side][fl], r);
        max[side][fl] = Math.max(max[side][fl], r);
      }
    }
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const other = side ^ 1;
      const list = Array.from(b.squares(pawn, side as Side).subarray(0, b.count(pawn, side as Side)));
      let extra = 0;
      for (let fl = 0; fl < 8; fl++) {
        if (!((files[side] >> fl) & 1)) continue;
        const n = list.filter((s) => (s & 7) === fl).length;
        extra += n - 1;
        const isolated = !(fl > 0 && (files[side] >> (fl - 1)) & 1) && !(fl < 7 && (files[side] >> (fl + 1)) & 1);
        if (isolated) {
          add(ISOLATED, sign * n * fm);
          add(ISOLATED + 1, sign * n * fe);
        }
      }
      add(DOUBLED, sign * extra * fm);
      add(DOUBLED + 1, sign * extra * fe);
      for (const s of list) {
        const fl = s & 7;
        const r = s >> 3;
        let passed = true;
        for (let ff = Math.max(0, fl - 1); ff <= Math.min(7, fl + 1) && passed; ff++) {
          if (side === 0 ? max[other][ff] > r : min[other][ff] < 8 && min[other][ff] < r) passed = false;
        }
        if (passed) {
          const rel = side === 0 ? r : 7 - r;
          add(PASSED_MG + rel, sign * fm);
          add(PASSED_EG + rel, sign * fe);
        }
      }
    }
    const rook = ix('r');
    if (rook >= 0) {
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const list = b.squares(rook, side as Side);
        for (let i = b.count(rook, side as Side) - 1; i >= 0; i--) {
          const fl = list[i] & 7;
          if ((files[side] >> fl) & 1) continue;
          const open = !((files[side ^ 1] >> fl) & 1);
          add(open ? ROOK_OPEN : ROOK_SEMI, sign * fm);
          add((open ? ROOK_OPEN : ROOK_SEMI) + 1, sign * fe);
        }
      }
    }
    const king = ix('k');
    if (king >= 0) {
      for (let side = 0; side < 2; side++) {
        if (b.count(king, side as Side) !== 1) continue;
        const k = b.squares(king, side as Side)[0];
        const r = k >> 3;
        if (side === 0 ? r > 1 : r < 6) continue;
        const fl = k & 7;
        let missing = 0;
        for (let ff = Math.max(0, fl - 1); ff <= Math.min(7, fl + 1); ff++) {
          const shielded =
            side === 0 ? min[0][ff] > r && min[0][ff] <= r + 2 : max[1][ff] >= 0 && max[1][ff] < r && max[1][ff] >= r - 2;
          if (!shielded) missing++;
        }
        add(KING_SHIELD, (side === 0 ? 1 : -1) * missing * fm);
      }
    }
  }

  MOB_LETTERS.forEach((l, mi) => {
    const type = ix(l);
    if (type < 0) return;
    const base = p.mobilityBase[l];
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const list = b.squares(type, side as Side);
      for (let i = b.count(type, side as Side) - 1; i >= 0; i--) {
        const m = b.reachCount(list[i], side as Side) - base;
        add(MOBILITY + mi * 2, sign * m * fm);
        add(MOBILITY + mi * 2 + 1, sign * m * fe);
      }
    }
  });

  const hook = b.hooks.evaluate;
  if (hook) f.constant += hook(b, 0) - hook(b, 1);
  add(TEMPO, b.side === 0 ? 1 : -1);
  return f;
}

/** Value of the features under parameter vector `v`. */
export function linearEval(f: Features, v: Float64Array): number {
  let s = f.constant;
  for (let k = 0; k < f.index.length; k++) s += f.coef[k] * v[f.index[k]];
  return s;
}
