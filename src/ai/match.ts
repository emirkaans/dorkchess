// Bot vs bot games without a worker (used by the selfplay script and tests).
// No React / DOM imports.

import { createGame, legalMoves, makeMove } from '../engine/index.ts';
import type { GameEndReason, GameState, PieceType, VariantDefinition } from '../engine/index.ts';
import { createRng } from './rng.ts';
import { chooseMove } from './search.ts';

/** Piece types of standard chess; anything else in a variant counts as a special piece. */
const STANDARD_TYPES: readonly PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];

export interface MatchOptions {
  /** Bot level (1–5) for each side. */
  readonly white: number;
  readonly black: number;
  readonly seed: number;
  /** Games still running after this many full moves end as "draw (limit)". */
  readonly maxFullMoves?: number;
  /** Opening variety: this many first plies are uniformly random legal moves. */
  readonly randomPlies?: number;
  /** Overrides each bot's time limit (ms). */
  readonly timeLimitMs?: number;
  readonly startFen?: string;
  readonly onMove?: (state: GameState) => void;
}

export type MatchReason = GameEndReason | 'limit';

export interface SpecialCapture {
  readonly type: PieceType;
  /** Full-move number of the capturing move. */
  readonly fullmove: number;
}

export interface MatchResult {
  readonly winner: 'w' | 'b' | null;
  readonly reason: MatchReason;
  readonly plies: number;
  readonly specialCaptures: readonly SpecialCapture[];
  readonly final: GameState;
}

export function playMatch(v: VariantDefinition, opts: MatchOptions): MatchResult {
  const maxFullMoves = opts.maxFullMoves ?? 200;
  const randomPlies = opts.randomPlies ?? 2;
  const rng = createRng(opts.seed);
  const specialCaptures: SpecialCapture[] = [];
  let state = createGame(v, opts.startFen ?? v.startPosition);
  let plies = 0;

  while (!state.result && state.position.fullmove <= maxFullMoves) {
    const pos = state.position;
    const move =
      plies < randomPlies
        ? rng.pick(legalMoves(v, pos))
        : chooseMove(v, state, pos.turn === 'w' ? opts.white : opts.black, { rng, timeLimitMs: opts.timeLimitMs }).move;
    if (move.captured !== undefined && !STANDARD_TYPES.includes(move.captured)) {
      specialCaptures.push({ type: move.captured, fullmove: pos.fullmove });
    }
    state = makeMove(v, state, move); // throws on an illegal move
    plies++;
    opts.onMove?.(state);
  }

  return state.result
    ? { winner: state.result.winner, reason: state.result.reason, plies, specialCaptures, final: state }
    : { winner: null, reason: 'limit', plies, specialCaptures, final: state };
}
