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

/** Puzzle Rush: solve as many as you can in the time, the puzzles getting harder; three misses end it. */
export const RUSH_MS = 180_000;
export const RUSH_LIVES = 3;
/** Difficulty of the first puzzle and how much each one adds. */
export const RUSH_START = 600;
export const RUSH_STEP = 50;
export const RUSH_COUNT = 45;

export interface RushResponse {
  readonly puzzles: readonly PuzzleData[];
  /** The signed-in player's best score (null for guests: theirs is in the browser). */
  readonly best: number | null;
}

export interface RushSaved {
  readonly best: number;
  /** Puzzle patches the run earned. */
  readonly newPatches: readonly string[];
}

/** A puzzle result's answer may carry new puzzle patches too. */
export interface PatchNews {
  readonly newPatches?: readonly string[];
}
