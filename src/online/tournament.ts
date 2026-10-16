// Tournaments, as on lichess, in two formats:
//
// - Arena: for a fixed time, players who are free are paired again and again;
//   a win is 2 points, a draw 1, and after two wins in a row a player is on
//   fire: wins and draws count double until a game is not won.
// - Swiss: a fixed number of rounds, everyone playing one game a round, paired
//   with someone on a similar score they have not met; a win is 1 point, a draw
//   ½, a bye (an odd player out) 1. Ties are broken by Buchholz: the sum of
//   one's opponents' scores.
//
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
export type TournamentFormat = 'arena' | 'swiss';
export const TOURNAMENT_FORMATS: readonly TournamentFormat[] = ['arena', 'swiss'];
/** Numbers of rounds a Swiss tournament can have. */
export const SWISS_ROUNDS = [3, 5, 7, 9] as const;
/** Between the end of a Swiss round and the next one (players get back to the page). */
export const SWISS_ROUND_GAP_MS = 15_000;

/** One game of a player in the tournament, as their score sheet shows it. */
export interface SheetEntry {
  readonly gameId: string;
  /** Won, drawn, lost; 'b' a Swiss bye (no game: `gameId` is empty). */
  readonly r: 'w' | 'd' | 'l' | 'b';
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
  /** Swiss: everyone played so far (never paired again), and the byes had. */
  readonly opponents?: readonly string[];
  readonly byes?: number;
}

export interface TournamentMeta {
  readonly id: string;
  readonly name: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  readonly startsAt: number;
  /** Arena: the end. Swiss: an estimate until it finishes (the rounds decide). */
  readonly endsAt: number;
  readonly createdBy: string;
  /** Missing on tournaments made before Swiss existed: Arena. */
  readonly format?: TournamentFormat;
  /** Swiss: how many rounds. */
  readonly rounds?: number;
}

export interface TournamentState extends TournamentMeta {
  readonly status: TournamentStatus;
  readonly players: Readonly<Record<string, TournamentPlayer>>;
  /** Swiss: the round being played (0 before the first), and when the next one starts. */
  readonly round?: number;
  readonly nextRoundAt?: number | null;
}

/** A tournament as its page shows it. */
export interface TournamentView extends TournamentMeta {
  readonly status: TournamentStatus;
  /** Standings, best first. */
  readonly standings: readonly (Omit<TournamentPlayer, 'lastOpponent' | 'colorBalance' | 'opponents'> & {
    readonly fire: boolean;
    /** Swiss: the tie-break. */
    readonly buchholz: number;
  })[];
  readonly format: TournamentFormat;
  readonly round: number;
  readonly nextRoundAt: number | null;
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
  readonly format: TournamentFormat;
  readonly rounds: number | null;
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
  /** Arena: its length. */
  readonly minutes: number;
  readonly startIn: number;
  readonly rated: boolean;
  readonly format?: TournamentFormat;
  /** Swiss: its rounds. */
  readonly rounds?: number;
}

export type TournamentClientMessage = { readonly t: 'join' } | { readonly t: 'withdraw' } | { readonly t: 'ping' };

export type TournamentServerMessage =
  | { readonly t: 'state'; readonly view: TournamentView }
  | { readonly t: 'paired'; readonly ticket: SeatTicket }
  /** The seat of the receiver's game going on (saved, not opened: they came back to the page). */
  | { readonly t: 'ticket'; readonly ticket: SeatTicket }
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

// ---------------------------------------------------------------------------
// Swiss

/** A Swiss player's sheet after a finished game: 1 for a win, ½ for a draw. */
export function swissScored(p: TournamentPlayer, gameId: string, result: 'w' | 'd' | 'l'): TournamentPlayer {
  const pts = result === 'w' ? 1 : result === 'd' ? 0.5 : 0;
  return { ...p, score: p.score + pts, sheet: [...p.sheet, { gameId, r: result, pts, fire: false }], game: null };
}

/** A bye: the odd player out of a round gets a point without a game. */
export const swissBye = (p: TournamentPlayer): TournamentPlayer => ({
  ...p,
  score: p.score + 1,
  sheet: [...p.sheet, { gameId: '', r: 'b', pts: 1, fire: false }],
  byes: (p.byes ?? 0) + 1,
});

/**
 * The sum of one's opponents' scores (the Swiss tie-break), over finished
 * games only: the opponent of a game still going is not counted yet.
 */
export function buchholz(
  p: Pick<TournamentPlayer, 'opponents' | 'sheet'>,
  all: Readonly<Record<string, TournamentPlayer>>,
): number {
  const finished = p.sheet.filter((s) => s.r !== 'b').length;
  return (p.opponents ?? []).slice(0, finished).reduce((sum, id) => sum + (all[id]?.score ?? 0), 0);
}

/** Swiss standings: score, then Buchholz, then name. */
export function swissStandings(all: Readonly<Record<string, TournamentPlayer>>): TournamentPlayer[] {
  const bh = new Map(Object.values(all).map((p) => [p.userId, buchholz(p, all)]));
  return Object.values(all).sort(
    (a, b) => b.score - a.score || bh.get(b.userId)! - bh.get(a.userId)! || a.username.localeCompare(b.username),
  );
}

/** Pairing attempts before giving up on avoiding every rematch. */
const SWISS_SEARCH_LIMIT = 20_000;

/**
 * One Swiss round for these players: if their number is odd, the lowest
 * ranked who has had no bye (else the lowest) sits out with a bye; the rest
 * are paired down the standings, each with the nearest player they have not
 * met (searching back when the last ones would have to meet again). When no
 * such pairing exists, rematches are allowed. White goes to whoever has played
 * Black more. Returns [white, black] user ids and the bye, if any.
 */
export function swissPairings(
  players: readonly TournamentPlayer[],
  all: Readonly<Record<string, TournamentPlayer>>,
  random: () => number,
): { pairs: [string, string][]; bye: string | null } {
  // The first round has no scores to go by: a random order.
  const fresh = players.every((p) => p.sheet.length === 0);
  const order = fresh
    ? [...players]
        .map((p) => [random(), p] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, p]) => p)
    : swissStandings(Object.fromEntries(players.map((p) => [p.userId, p]))).map((p) => all[p.userId] ?? p);
  let bye: string | null = null;
  if (order.length % 2 === 1) {
    const reversed = [...order].reverse();
    const odd = reversed.find((p) => (p.byes ?? 0) === 0) ?? reversed[0];
    bye = odd.userId;
    order.splice(order.indexOf(odd), 1);
  }
  const met = (a: TournamentPlayer, b: TournamentPlayer) => (a.opponents ?? []).includes(b.userId);
  let tries = 0;
  const search = (left: TournamentPlayer[]): [TournamentPlayer, TournamentPlayer][] | null => {
    if (left.length === 0) return [];
    if (++tries > SWISS_SEARCH_LIMIT) return null;
    const [a, ...rest] = left;
    for (let i = 0; i < rest.length; i++) {
      if (met(a, rest[i])) continue;
      const after = search([...rest.slice(0, i), ...rest.slice(i + 1)]);
      if (after) return [[a, rest[i]], ...after];
    }
    return null;
  };
  let matched = search(order);
  if (!matched) {
    matched = [];
    for (let i = 0; i + 1 < order.length; i += 2) matched.push([order[i], order[i + 1]]);
  }
  const pairs = matched.map(([a, b]): [string, string] => {
    const aWhite = a.colorBalance < b.colorBalance || (a.colorBalance === b.colorBalance && random() < 0.5);
    return aWhite ? [a.userId, b.userId] : [b.userId, a.userId];
  });
  return { pairs, bye };
}

/** A Swiss tournament's likely end, for the list until it really ends. */
export function swissEndEstimate(startsAt: number, rounds: number, initialMs: number, incrementMs: number): number {
  return startsAt + rounds * (initialMs * 2 + incrementMs * 80 + SWISS_ROUND_GAP_MS + 30_000);
}
