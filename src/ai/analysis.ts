// Post-game analysis helpers: scores from White's view, move classification,
// display. Pure functions (no React / DOM); the search runs in the worker.

import type { Color, GameState } from '../engine/index.ts';
import { MATE, MATE_BOUND } from './evaluate.ts';

/** A position's evaluation, centipawns from White's view (mate scores keep their MATE - plies form). */
export type WhiteScore = number;

/** Search score (side to move's view) as White's view. */
export const toWhite = (score: number, turn: Color): WhiteScore => (turn === 'w' ? score : -score);

/** Score of a finished position without searching: mate for the winner, 0 for draws; null if not over. */
export function terminalScore(state: GameState): WhiteScore | null {
  const r = state.result;
  if (!r) return null;
  if (r.winner === null) return 0;
  return r.winner === 'w' ? MATE : -MATE;
}

export const isMate = (s: number) => Math.abs(s) > MATE_BOUND;

/** "+1.3", "-0.4", "#3" (White mates in 3), "#-2" (Black mates in 2), "#" for a finished mate. */
export function formatScore(s: WhiteScore): string {
  if (isMate(s)) {
    const plies = MATE - Math.abs(s);
    if (plies === 0) return '#';
    const moves = Math.ceil(plies / 2);
    return s > 0 ? `#${moves}` : `#-${moves}`;
  }
  const pawns = s / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

/** White's share of the evaluation bar (0..1), as an expected-score curve. */
export function whiteShare(s: WhiteScore): number {
  if (isMate(s)) return s > 0 ? 1 : 0;
  return 1 / (1 + 10 ** (-s / 400));
}

/** Scores are clamped for comparisons, so a mate does not dwarf everything else. */
const CLAMP = 1000;
const clamp = (s: number) => Math.max(-CLAMP, Math.min(CLAMP, s));

export type MoveMark = 'blunder' | 'mistake' | null;

/** Losses (centipawns, mover's view) above these mark a move as a mistake / blunder. */
export const MISTAKE = 100;
export const BLUNDER = 200;

/**
 * Marks each move by how much the evaluation dropped for the side that played
 * it: `evals[i]` is the score before move i (White's view), `evals[i + 1]` after.
 * Unknown scores (null) leave the move unmarked.
 */
export function classifyMoves(evals: readonly (WhiteScore | null)[], turns: readonly Color[]): MoveMark[] {
  const marks: MoveMark[] = [];
  for (let i = 0; i + 1 < evals.length; i++) {
    const before = evals[i];
    const after = evals[i + 1];
    if (before === null || after === null) {
      marks.push(null);
      continue;
    }
    const drop = turns[i] === 'w' ? clamp(before) - clamp(after) : clamp(after) - clamp(before);
    marks.push(drop > BLUNDER ? 'blunder' : drop > MISTAKE ? 'mistake' : null);
  }
  return marks;
}

/** Graph point for a score: clamped to ±800 so ordinary swings stay readable. */
export const graphValue = (s: WhiteScore) => Math.max(-800, Math.min(800, isMate(s) ? Math.sign(s) * 800 : s));
