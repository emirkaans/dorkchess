// Puzzles: the shapes of the puzzle API (server/puzzles.ts) and the rules for
// following a solution. Shared by the browser and the Worker. Pure.

export interface PuzzleData {
  readonly id: string;
  readonly variantId: string;
  /** The position before the opponent's move that sets the puzzle up. */
  readonly fen: string;
  /** Solution in UCI: the opponent's move first, then the player's, and so on. */
  readonly moves: readonly string[];
  readonly rating: number;
  readonly themes: readonly string[];
}

/** A player's puzzle rating as the server reports it. */
export interface PuzzleRating {
  readonly rating: number;
  readonly provisional: boolean;
}

export interface PuzzleNext {
  readonly puzzle: PuzzleData | null;
  /** The signed-in player's puzzle rating (null for guests). */
  readonly rating: PuzzleRating | null;
}

export interface PuzzleResult extends PuzzleRating {
  /** What this puzzle changed (0 when it was tried before: only the first try counts). */
  readonly diff: number;
}

/** Puzzle themes offered as filters (lichess theme names). */
export const PUZZLE_THEMES = [
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'fork',
  'pin',
  'skewer',
  'sacrifice',
  'endgame',
] as const;
export type PuzzleTheme = (typeof PUZZLE_THEMES)[number];

/**
 * Is `uci` the right move at this point of the solution? On the last move
 * any mate is right too (lichess accepts every mating move).
 */
export function isSolutionMove(moves: readonly string[], ply: number, uci: string, givesMate: boolean): boolean {
  if (moves[ply] === uci) return true;
  return ply === moves.length - 1 && givesMate;
}
