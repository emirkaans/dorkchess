// Static evaluation. Variant-independent apart from the optional hooks in the
// variant definition (pieceValues, evaluateExtra). No React / DOM imports.

import { opposite, rankOf, fileOf, pseudoMoves } from '../engine/index.ts';
import type { Color, Position, VariantDefinition } from '../engine/index.ts';

/** Score for being mated; the search subtracts the ply so shorter mates score higher. */
export const MATE = 100000;
/** Scores beyond this are mate scores. */
export const MATE_BOUND = MATE - 1000;

/** Weight per pseudo-legal move of mobility difference (level 5 only). */
export const MOBILITY_WEIGHT = 2;

// Piece-square tables for the standard pieces, written from White's point of
// view with rank 8 first (as on a printed board). Special pieces have none.
// prettier-ignore
const PST: Readonly<Record<string, readonly number[]>> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

/** King table for the endgame: walk to the centre. */
// prettier-ignore
const KING_END: readonly number[] = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

/** Total non-pawn, non-king material (both sides) at or below which the endgame king table is used. */
const ENDGAME_MATERIAL = 2000;

/** Table index for a piece of `color` on square `sq` (tables are from White's view, rank 8 first). */
const pstIndex = (sq: number, color: Color) =>
  (color === 'w' ? 7 - rankOf(sq) : rankOf(sq)) * 8 + fileOf(sq);

export interface EvalOptions {
  readonly mobility?: boolean;
}

/**
 * Static evaluation in centipawns from the side to move's point of view:
 * material + piece-square tables + variant term (+ mobility when enabled).
 */
export function evaluate(v: VariantDefinition, pos: Position, opts: EvalOptions = {}): number {
  const values = v.pieceValues;
  let white = 0;
  let pieceMaterial = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p || p.type === 'k' || p.type === 'p') continue;
    pieceMaterial += values[p.type] ?? 0;
  }
  const endgame = pieceMaterial <= ENDGAME_MATERIAL;

  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p) continue;
    const table = p.type === 'k' && endgame ? KING_END : PST[p.type];
    const s = (values[p.type] ?? 0) + (table ? table[pstIndex(sq, p.color)] : 0);
    white += p.color === 'w' ? s : -s;
  }

  if (v.evaluateExtra) white += v.evaluateExtra(pos, 'w') - v.evaluateExtra(pos, 'b');

  const score = pos.turn === 'w' ? white : -white;
  return opts.mobility ? score + mobility(v, pos) : score;
}

/**
 * Mobility term from the side to move's point of view: difference of
 * pseudo-legal move counts times MOBILITY_WEIGHT.
 */
export function mobility(v: VariantDefinition, pos: Position): number {
  const own = pseudoMoves(v, pos).length;
  const other = pseudoMoves(v, { ...pos, turn: opposite(pos.turn), ep: null }).length;
  return (own - other) * MOBILITY_WEIGHT;
}
