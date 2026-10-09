import { opposite } from './board.ts';
import { applyMove, isSquareAttacked, pieceDef, pseudoMoves, pseudoMovesFrom } from './movegen.ts';
import type { Color, Move, Position, Square, VariantDefinition } from './types.ts';

export function royalSquares(v: VariantDefinition, pos: Position, color: Color): Square[] {
  const out: Square[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p && p.color === color && pieceDef(v, p.type).royal) out.push(sq);
  }
  return out;
}

/** Is any royal piece of `color` attacked by `enemy`? (allocation-free version of royalSquares + isSquareAttacked) */
function royalAttacked(v: VariantDefinition, pos: Position, color: Color, enemy: Color): boolean {
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p && p.color === color && pieceDef(v, p.type).royal && isSquareAttacked(v, pos, sq, enemy)) return true;
  }
  return false;
}

/**
 * Is `color`'s royal piece attacked in `pos`? Attacks are computed with the
 * position's own variant state, so e.g. an enemy Jester attacks in the form
 * implied by `pos.extra`.
 */
export function isInCheck(v: VariantDefinition, pos: Position, color: Color = pos.turn): boolean {
  const enemy = opposite(color);
  return royalAttacked(v, pos, color, enemy);
}

/**
 * A pseudo-legal move is legal if, after it is applied (including the variant
 * state update), the mover's royal pieces cannot be captured by the opponent.
 */
export function isLegal(v: VariantDefinition, pos: Position, move: Move): boolean {
  const next = applyMove(v, pos, move);
  return !isInCheck(v, next, pos.turn);
}

export function legalMoves(v: VariantDefinition, pos: Position): Move[] {
  return pseudoMoves(v, pos).filter((m) => isLegal(v, pos, m));
}

export function legalMovesFrom(v: VariantDefinition, pos: Position, from: Square): Move[] {
  const p = pos.board[from];
  if (!p || p.color !== pos.turn) return [];
  return pseudoMovesFrom(v, pos, from).filter((m) => isLegal(v, pos, m));
}

/** Leaf-node count to `depth` (bulk counting at depth 1). */
export function perft(v: VariantDefinition, pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(v, pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(v, applyMove(v, pos, m), depth - 1);
  return n;
}
