import { describe, expect, it } from 'vitest';
import { PATCHES, newPuzzlePatches } from '../src/achievements/patches.ts';
import { RUSH_COUNT, RUSH_START, RUSH_STEP } from '../src/online/puzzle.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('puzzle rush, bulmaca yamaları, liderler', () => {
  it('her yama ya oyunla ya bulmacayla kazanılır', () => {
    for (const p of PATCHES) expect(!!p.earned !== !!p.puzzle).toBe(true);
  });

  it('bulmaca yamaları kayda göre verilir, olanlar tekrar verilmez', () => {
    const none = { puzzlesSolved: 0, dailyStreak: 0, rushBest: 0 };
    expect(newPuzzlePatches(none, new Set())).toEqual([]);
    expect(newPuzzlePatches({ puzzlesSolved: 100, dailyStreak: 7, rushBest: 20 }, new Set())).toEqual([
      'puzzles-100',
      'daily-7',
      'rush-20',
    ]);
    expect(newPuzzlePatches({ ...none, rushBest: 25 }, new Set(['rush-20']))).toEqual([]);
  });

  it('rush bulmacaları kolaydan zora, veritabanının aralığında', () => {
    const last = RUSH_START + (RUSH_COUNT - 1) * RUSH_STEP;
    expect(RUSH_START).toBeGreaterThanOrEqual(400);
    expect(last + RUSH_STEP).toBeLessThanOrEqual(3200);
  });

  it('adresler: /rush ve /leaderboard', () => {
    expect(parseRoute('/rush')).toEqual({ kind: 'rush' });
    expect(parseRoute('/leaderboard')).toEqual({ kind: 'leaderboard' });
    expect(pathOf({ kind: 'rush' })).toBe('/rush');
    expect(pathOf({ kind: 'leaderboard' })).toBe('/leaderboard');
  });
});
