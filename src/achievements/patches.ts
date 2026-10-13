// Patches for the battle jacket on a profile: what each one is for and how
// it looks. A finished online game is checked for every game patch the player
// does not have yet (server/ratings.ts awards them); puzzle results for the
// puzzle patches (server/puzzle-patches.ts). Pure.

import type { Color } from '../engine/index.ts';
import { speedOf } from '../rating/categories.ts';

/** What a finished game tells about one of its (signed-in) players. */
export interface PatchContext {
  readonly color: Color;
  readonly won: boolean;
  readonly drawn: boolean;
  /** How the game ended: 'checkmate', 'resign', 'timeout', … */
  readonly termination: string;
  /** Moves of the game, in SAN. */
  readonly moves: readonly string[];
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  readonly rating: number | null;
  readonly opponentRating: number | null;
  /** The player's clock when the game ended (null without a clock). */
  readonly clockLeftMs: number | null;
  /** Online games finished, this one included. */
  readonly gamesPlayed: number;
  /** Wins in a row up to and including this game. */
  readonly winStreak: number;
  /** Variants the player has won a game in, this one included. */
  readonly variantsWon: readonly string[];
  /** Every variant of the site (for the patch that needs all of them). */
  readonly allVariants: readonly string[];
}

/** A player's puzzle record, after the result just sent. */
export interface PuzzlePatchContext {
  /** Puzzles solved on the first try (rated puzzles). */
  readonly puzzlesSolved: number;
  /** Daily puzzles solved in a row. */
  readonly dailyStreak: number;
  /** Best Puzzle Rush score. */
  readonly rushBest: number;
}

export type PatchShape = 'circle' | 'shield' | 'star' | 'diamond' | 'rect';

export interface PatchDef {
  readonly id: string;
  readonly shape: PatchShape;
  /** Fill and text colours. */
  readonly fill: string;
  readonly ink: string;
  /** A game patch: earned by a finished online game. */
  readonly earned?: (c: PatchContext) => boolean;
  /** A puzzle patch: earned by a puzzle record. */
  readonly puzzle?: (c: PuzzlePatchContext) => boolean;
}

const PINK = '#ff2e93';
const LIME = '#c6ff3d';
const BONE = '#f1eee8';
const INK = '#0a0a0b';

/** The player's own last move (the mating move when they won by mate). */
const lastOwnMove = (c: PatchContext) => {
  const own = c.moves.filter((_, i) => (i % 2 === 0) === (c.color === 'w'));
  return own[own.length - 1] ?? '';
};
const mated = (c: PatchContext) => c.won && c.termination === 'checkmate';

/** Every patch, in the order the jacket shows them. */
export const PATCHES: readonly PatchDef[] = [
  { id: 'first-blood', shape: 'circle', fill: PINK, ink: INK, earned: (c) => c.won },
  { id: 'checkmate', shape: 'shield', fill: LIME, ink: INK, earned: mated },
  {
    id: 'pawn-mate',
    shape: 'star',
    fill: BONE,
    ink: INK,
    earned: (c) => mated(c) && /^[a-h]/.test(lastOwnMove(c)),
  },
  { id: 'blitzkrieg', shape: 'diamond', fill: PINK, ink: INK, earned: (c) => mated(c) && c.moves.length <= 20 },
  {
    id: 'last-breath',
    shape: 'rect',
    fill: LIME,
    ink: INK,
    earned: (c) => c.won && c.clockLeftMs !== null && c.clockLeftMs < 2000,
  },
  { id: 'broke-them', shape: 'circle', fill: BONE, ink: INK, earned: (c) => c.won && c.termination === 'resign' },
  { id: 'bullet', shape: 'star', fill: PINK, ink: INK, earned: (c) => c.won && speedOf(c.timeControlId) === 'bullet' },
  {
    id: 'giant-slayer',
    shape: 'shield',
    fill: PINK,
    ink: INK,
    earned: (c) =>
      c.won && c.rated && c.rating !== null && c.opponentRating !== null && c.opponentRating - c.rating >= 200,
  },
  { id: 'streak-5', shape: 'diamond', fill: LIME, ink: INK, earned: (c) => c.winStreak >= 5 },
  { id: 'truce', shape: 'circle', fill: LIME, ink: INK, earned: (c) => c.drawn },
  { id: 'marathon', shape: 'rect', fill: BONE, ink: INK, earned: (c) => c.moves.length >= 160 },
  {
    id: 'rule-breaker',
    shape: 'star',
    fill: LIME,
    ink: INK,
    earned: (c) => c.won && c.variantId !== c.allVariants[0],
  },
  {
    id: 'anarchist',
    shape: 'shield',
    fill: BONE,
    ink: INK,
    earned: (c) => c.allVariants.every((v) => c.variantsWon.includes(v)),
  },
  { id: 'games-10', shape: 'rect', fill: PINK, ink: INK, earned: (c) => c.gamesPlayed >= 10 },
  { id: 'games-100', shape: 'diamond', fill: BONE, ink: INK, earned: (c) => c.gamesPlayed >= 100 },
  { id: 'puzzles-100', shape: 'circle', fill: LIME, ink: INK, puzzle: (c) => c.puzzlesSolved >= 100 },
  { id: 'daily-7', shape: 'shield', fill: PINK, ink: INK, puzzle: (c) => c.dailyStreak >= 7 },
  { id: 'rush-20', shape: 'star', fill: LIME, ink: INK, puzzle: (c) => c.rushBest >= 20 },
];

export const patchById = (id: string): PatchDef | undefined => PATCHES.find((p) => p.id === id);

/** Patches this game earns that the player does not have yet. */
export const newPatches = (c: PatchContext, have: ReadonlySet<string>): string[] =>
  PATCHES.filter((p) => !have.has(p.id) && p.earned?.(c)).map((p) => p.id);

/** Puzzle patches this record earns that the player does not have yet. */
export const newPuzzlePatches = (c: PuzzlePatchContext, have: ReadonlySet<string>): string[] =>
  PATCHES.filter((p) => !have.has(p.id) && p.puzzle?.(c)).map((p) => p.id);
