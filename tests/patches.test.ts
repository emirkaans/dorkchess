import { describe, expect, it } from 'vitest';
import { PATCHES, newPatches } from '../src/achievements/patches.ts';
import type { PatchContext } from '../src/achievements/patches.ts';

const base: PatchContext = {
  color: 'w',
  won: false,
  drawn: false,
  termination: 'resign',
  moves: ['e4', 'e5', 'Nf3', 'Nc6'],
  variantId: 'standard',
  timeControlId: '5+0',
  rated: false,
  rating: null,
  opponentRating: null,
  clockLeftMs: 120_000,
  gamesPlayed: 1,
  winStreak: 0,
  variantsWon: [],
  allVariants: ['standard', 'burokrat', 'jester', 'diplomat'],
};
const earned = (c: Partial<PatchContext>, have: string[] = []) => newPatches({ ...base, ...c }, new Set(have));

describe('yamalar', () => {
  it('her yamanın benzersiz kimliği var', () => {
    expect(new Set(PATCHES.map((p) => p.id)).size).toBe(PATCHES.length);
  });

  it('kaybeden ilk oyunda yama almaz; ilk galibiyet ve terk ettirme', () => {
    expect(earned({})).toEqual([]);
    expect(earned({ won: true, winStreak: 1 })).toEqual(['first-blood', 'broke-them']);
  });

  it('mat, piyonla mat ve 10 hamlede mat', () => {
    const scholar = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    expect(earned({ won: true, termination: 'checkmate', moves: scholar })).toEqual(
      expect.arrayContaining(['checkmate', 'blitzkrieg']),
    );
    expect(earned({ won: true, termination: 'checkmate', moves: scholar })).not.toContain('pawn-mate');
    expect(
      earned({ won: true, termination: 'checkmate', moves: [...scholar.slice(0, 6), 'Bxf7', 'Kxf7', 'g4#'] }),
    ).toContain('pawn-mate');
    // As Black: the player's own last move counts, not White's.
    expect(
      earned({ color: 'b', won: true, termination: 'checkmate', moves: ['f3', 'e5', 'g4', 'Qh4#'] }),
    ).not.toContain('pawn-mate');
  });

  it('son saniye, bullet, dev avcısı, seri, beraberlik, maraton', () => {
    expect(earned({ won: true, clockLeftMs: 1500 })).toContain('last-breath');
    expect(earned({ won: true, clockLeftMs: null })).not.toContain('last-breath');
    expect(earned({ won: true, timeControlId: '1+0' })).toContain('bullet');
    expect(earned({ won: true, rated: true, rating: 1500, opponentRating: 1720 })).toContain('giant-slayer');
    expect(earned({ won: true, rated: true, rating: 1500, opponentRating: 1650 })).not.toContain('giant-slayer');
    expect(earned({ won: true, winStreak: 5 })).toContain('streak-5');
    expect(earned({ drawn: true, termination: 'agreement' })).toEqual(['truce']);
    expect(earned({ moves: Array(160).fill('e4') })).toContain('marathon');
  });

  it('varyant galibiyetleri, oyun sayıları; zaten olan yama tekrar verilmez', () => {
    expect(earned({ won: true, variantId: 'jester' })).toContain('rule-breaker');
    expect(earned({ won: true, variantsWon: ['standard', 'burokrat', 'jester', 'diplomat'] })).toContain('anarchist');
    expect(earned({ gamesPlayed: 10 })).toEqual(['games-10']);
    expect(earned({ gamesPlayed: 100 })).toEqual(['games-10', 'games-100']);
    expect(earned({ won: true }, ['first-blood'])).toEqual(['broke-them']);
  });
});
