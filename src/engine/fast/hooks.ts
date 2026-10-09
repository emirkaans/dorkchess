// Variant hooks for the fast search board. A variant whose rules are fully
// described by piece data (patterns, canCapture, capturable) needs none of these.

import type { Color, MovePattern, PieceType, Position } from '../types.ts';
import type { FastBoard } from './board.ts';

/** Color as a number on the fast board: 0 = white, 1 = black. */
export type Side = 0 | 1;

export interface FastHooks {
  /** Number of integer slots of variant state kept on the board (saved/restored with every move). */
  readonly extraSlots?: number;
  /** Fills `b.extra` from the engine position's extra state. */
  readonly readExtra?: (b: FastBoard, pos: Position) => void;
  /** Piece types whose patterns depend on the position; `patterns` is asked for them. */
  readonly dynamicTypes?: readonly PieceType[];
  readonly patterns?: (b: FastBoard, type: PieceType, side: Side) => readonly MovePattern[];
  /**
   * Called while a move is made, before the board changes (same timing as the
   * engine's afterMove): may update `b.extra`.
   */
  readonly afterMove?: (b: FastBoard, movedType: PieceType, side: Side) => void;
  /** Position-dependent capture rule, same meaning as VariantDefinition.captureAllowed. */
  readonly captureAllowed?: (b: FastBoard, from: number, victimSquare: number, victimCode: number) => boolean;
  /** Variant state that distinguishes positions (repetition / transposition table), as a 32-bit int. */
  readonly hashExtra?: (b: FastBoard) => number;
  /** Bot evaluation term in centipawns for `side` (same meaning as VariantDefinition.evaluateExtra). */
  readonly evaluate?: (b: FastBoard, side: Side) => number;
}

export const sideOf = (c: Color): Side => (c === 'w' ? 0 : 1);
export const colorOf = (s: Side): Color => (s === 0 ? 'w' : 'b');
