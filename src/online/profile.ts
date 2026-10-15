// Shapes of the profile API (server/profiles.ts), shared with the browser. Pure.

import type { JacketStats } from '../achievements/jackets.ts';

import type { Color } from '../engine/index.ts';

export interface ProfileRating {
  /** 'bullet' … 'classical', or 'variant:<id>' (see src/rating/categories.ts). */
  readonly category: string;
  readonly rating: number;
  readonly provisional: boolean;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

/** A rival: an opponent with an account, and the record against them. */
export interface Rival {
  readonly username: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface ProfileResponse {
  readonly username: string;
  readonly createdAt: number;
  /** Finished online games (rated or not). */
  readonly games: number;
  readonly ratings: readonly ProfileRating[];
  /** Patches on the battle jacket, oldest first. */
  readonly patches: readonly { readonly id: string; readonly earnedAt: number }[];
  readonly followers: number;
  readonly following: number;
  /** The signed-in viewer follows this player. */
  readonly followed: boolean;
  /** The opponent who beat the player most (online games against accounts), and the one they beat most. */
  readonly nemesis: Rival | null;
  readonly victim: Rival | null;
  /** The jacket the player picked. */
  readonly jacket: string;
  /** What earns the other jackets. */
  readonly stats: JacketStats;
}

/** A finished game, seen from the profile's player. */
export interface ProfileGame {
  readonly id: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  /** The profile player's colour. */
  readonly color: Color;
  readonly opponent: string;
  /** The opponent's account (links to their profile), or null for a guest. */
  readonly opponentUsername: string | null;
  readonly opponentRating: number | null;
  /** The player's rating before the game, and what the game changed (rated games). */
  readonly rating: number | null;
  readonly diff: number | null;
  /** '1-0', '0-1' or '1/2-1/2'. */
  readonly result: string;
  readonly termination: string;
  readonly endedAt: number;
}

export interface RatingPoint {
  readonly at: number;
  readonly rating: number;
}

/** The game's outcome for the profile's player. */
export function outcomeFor(g: Pick<ProfileGame, 'result' | 'color'>): 'win' | 'loss' | 'draw' {
  if (g.result === '1/2-1/2') return 'draw';
  return (g.result === '1-0') === (g.color === 'w') ? 'win' : 'loss';
}
