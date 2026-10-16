// Arena tournaments, as on lichess: for a fixed time, players who are free are
// paired again and again; a win is 2 points, a draw 1, and after two wins in a
// row a player is on fire: wins and draws count double until a game is not won.
// Shapes of the tournament API (server/tournament.ts) and its rules. Pure.

import { TIME_CONTROLS } from '../clock/clock.ts';
import type { Color } from '../engine/index.ts';
import type { SeatTicket } from './protocol.ts';

/** Lengths a tournament can last, in minutes. */
export const TOURNAMENT_MINUTES = [20, 30, 45, 60, 90] as const;
/** How soon after it is made a tournament can start, in minutes. */
export const TOURNAMENT_START_IN = [2, 5, 10, 15, 30, 60] as const;
export const TOURNAMENT_MAX_PLAYERS = 200;
/** Time controls a tournament can use: those with a clock. */
export const TOURNAMENT_TIME_CONTROLS: readonly string[] = TIME_CONTROLS.filter((tc) => tc.initialMs !== null).map(
  (tc) => tc.id,
);
/** A draw before this many half-moves gives no points (as on lichess: no quick agreed draws). */
export const EARLY_DRAW_PLIES = 20;
/** Free players are paired this often while the tournament runs. */
export const PAIRING_MS = 3000;

export type TournamentStatus = 'created' | 'started' | 'finished';

/** One game of a player in the tournament, as their score sheet shows it. */
export interface SheetEntry {
  readonly gameId: string;
  /** Won, drawn, lost. */
  readonly r: 'w' | 'd' | 'l';
  /** The points it gave. */
  readonly pts: number;
  /** Played on fire (points doubled). */
  readonly fire: boolean;
}

export interface TournamentPlayer {
  readonly userId: string;
  readonly username: string;
  readonly score: number;
  readonly sheet: readonly SheetEntry[];
  /** Wins in a row; from 2 on, the player is on fire. */
  readonly streak: number;
  /** Not paired until they come back (left, or did not move in a game). */
  readonly paused: boolean;
  /** The game being played, or null. */
  readonly game: string | null;
  /** The last opponent (not paired with them again at once if anyone else is free). */
  readonly lastOpponent: string | null;
  /** Games played as White minus games as Black (colours are evened out). */
  readonly colorBalance: number;
}

export interface TournamentMeta {
  readonly id: string;
  readonly name: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly createdBy: string;
}

export interface TournamentState extends TournamentMeta {
  readonly status: TournamentStatus;
  readonly players: Readonly<Record<string, TournamentPlayer>>;
}

/** A tournament as its page shows it. */
export interface TournamentView extends TournamentMeta {
  readonly status: TournamentStatus;
  /** Standings, best first. */
  readonly standings: readonly (Omit<TournamentPlayer, 'lastOpponent' | 'colorBalance'> & { readonly fire: boolean })[];
  /** Games being played. */
  readonly games: number;
  /** The receiver's user id when they joined, else null. */
  readonly you: string | null;
  readonly now: number;
}

/** A tournament in the list. */
export interface TournamentSummary {
  readonly id: string;
  readonly name: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly status: TournamentStatus;
  readonly players: number;
  readonly winner: string | null;
}

export interface TournamentList {
  readonly live: readonly TournamentSummary[];
  readonly upcoming: readonly TournamentSummary[];
  readonly finished: readonly TournamentSummary[];
}

export interface CreateTournament {
  readonly name: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly minutes: number;
  readonly startIn: number;
  readonly rated: boolean;
}

export type TournamentClientMessage = { readonly t: 'join' } | { readonly t: 'withdraw' } | { readonly t: 'ping' };

export type TournamentServerMessage =
  | { readonly t: 'state'; readonly view: TournamentView }
  | { readonly t: 'paired'; readonly ticket: SeatTicket }
  | { readonly t: 'error'; readonly code: 'signed-out' | 'full' | 'finished' | 'bad-request' };

export const onFire = (p: Pick<TournamentPlayer, 'streak'>): boolean => p.streak >= 2;

/** What is wrong with a new tournament's name, or null. */
export function tournamentNameProblem(name: string): boolean {
  const n = name.trim();
  return n.length < 3 || n.length > 30 || !/^[\p{L}\p{N} '_.!-]+$/u.test(n);
}

export const newPlayer = (userId: string, username: string): TournamentPlayer => ({
  userId,
  username,
  score: 0,
  sheet: [],
  streak: 0,
  paused: false,
  game: null,
  lastOpponent: null,
  colorBalance: 0,
});

/**
 * A player's sheet after a finished game: `result` from their side, `plies` the
 * game's length. Points double on fire; an early draw gives none.
 */
export function scored(p: TournamentPlayer, gameId: string, result: 'w' | 'd' | 'l', plies: number): TournamentPlayer {
  const fire = onFire(p);
  const base = result === 'w' ? 2 : result === 'd' && plies >= EARLY_DRAW_PLIES ? 1 : 0;
  const pts = fire ? base * 2 : base;
  return {
    ...p,
    score: p.score + pts,
    sheet: [...p.sheet, { gameId, r: result, pts, fire }],
    streak: result === 'w' ? p.streak + 1 : 0,
    game: null,
  };
}

/** Standings order: score, then (on a tie) the better performance in fewer games, then name. */
export function standings<P extends Pick<TournamentPlayer, 'score' | 'sheet' | 'username'>>(
  players: readonly P[],
): P[] {
  return [...players].sort(
    (a, b) => b.score - a.score || a.sheet.length - b.sheet.length || a.username.localeCompare(b.username),
  );
}

/**
 * Pairs the free players: by standing, each with the nearest one below that was
 * not their last opponent (or the nearest at all when no one else is left).
 * White goes to whoever has played Black more. Returns [white, black] user ids.
 */
export function pairings(free: readonly TournamentPlayer[], random: () => number): [string, string][] {
  const left = standings(free);
  const pairs: [string, string][] = [];
  while (left.length >= 2) {
    const a = left.shift()!;
    let i = left.findIndex((b) => b.userId !== a.lastOpponent && a.userId !== b.lastOpponent);
    if (i < 0) i = 0;
    const [b] = left.splice(i, 1);
    const aWhite = a.colorBalance < b.colorBalance || (a.colorBalance === b.colorBalance && random() < 0.5);
    pairs.push(aWhite ? [a.userId, b.userId] : [b.userId, a.userId]);
  }
  return pairs;
}

/** The result of a finished game from one side. */
export const resultFor = (color: Color, winner: Color | null): 'w' | 'd' | 'l' =>
  winner === null ? 'd' : winner === color ? 'w' : 'l';
