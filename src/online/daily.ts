// The daily puzzle ("Günün sabotajı"): the same puzzle for everyone each day,
// a Wordle-style grid to share and a streak of days. The day turns at midnight
// in Turkey (UTC+3 all year). Shared by the browser and the Worker. Pure.

import type { PuzzleData } from './puzzle.ts';

/** Daily puzzle #1. */
export const DAILY_FIRST_DAY = '2026-10-12';
const OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** One square of the grid, a move of the player's: found at once, found after misses, or shown. */
export type DailySquare = 'h' | 'm' | 's';
const GRID = /^[hms]{1,40}$/;

export interface DailyResult {
  readonly solved: boolean;
  readonly grid: string;
}

export interface DailyResponse {
  /** 'YYYY-MM-DD' in Turkey. */
  readonly day: string;
  readonly number: number;
  readonly puzzle: PuzzleData | null;
  /** The signed-in player's result today (null for guests and before playing). */
  readonly result: DailyResult | null;
  /** The signed-in player's streak (0 for guests: theirs is in the browser). */
  readonly streak: number;
}

export interface DailySaved {
  readonly streak: number;
}

/** The day at `now`, as 'YYYY-MM-DD'. */
export const dailyDay = (now: number): string => new Date(now + OFFSET_MS).toISOString().slice(0, 10);

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The number of the day's puzzle (#1 on the first day). */
export const dailyNumber = (day: string): number => Math.round((dayMs(day) - dayMs(DAILY_FIRST_DAY)) / DAY_MS) + 1;

/** The day before. */
export const previousDay = (day: string): string => new Date(dayMs(day) - DAY_MS).toISOString().slice(0, 10);

/** When the next puzzle comes (ms since the epoch). */
export const nextDailyAt = (now: number): number => dayMs(dailyDay(now)) + DAY_MS - OFFSET_MS;

export const isDailyGrid = (grid: unknown): grid is string => typeof grid === 'string' && GRID.test(grid);

/** Solved: every move found, none shown. */
export const gridSolved = (grid: string): boolean => isDailyGrid(grid) && !grid.includes('s');

/**
 * Days solved in a row, up to today. The streak is still alive on a day
 * not played yet when yesterday was solved.
 */
export function streakOf(solvedDays: Iterable<string>, today: string): number {
  const days = new Set(solvedDays);
  let day = days.has(today) ? today : previousDay(today);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = previousDay(day);
  }
  return n;
}

const EMOJI: Record<DailySquare, string> = { h: '🟩', m: '🟥', s: '⬛' };

export const gridEmoji = (grid: string): string => [...grid].map((c) => EMOJI[c as DailySquare] ?? '').join('');

/** The text to share: "punkchess #12 🟩🟥🟩 🔥3" and a link. */
export function dailyShareText(number: number, grid: string, streak: number, url: string): string {
  return `punkchess #${number} ${gridEmoji(grid)}${streak > 1 ? ` 🔥${streak}` : ''}\n${url}`;
}

/** A number from a day, to pick its puzzle (FNV-1a). */
export function dayHash(day: string): number {
  let h = 0x811c9dc5;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}
