import { describe, expect, it } from 'vitest';
import { DEFAULT_GLICKO, aged, isProvisional, rateGame, update } from '../src/rating/glicko2.ts';
import { allCategories, ratingCategory, speedOf } from '../src/rating/categories.ts';

describe('Glicko-2', () => {
  it("Glickman'ın örneğiyle aynı sonucu verir (1500/200/0.06, üç oyun)", () => {
    // tau differs from the paper's 0.5, so only rating and deviation are compared closely.
    const next = update({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    expect(next.rating).toBeCloseTo(1464.05, 0);
    expect(next.rd).toBeCloseTo(151.52, 0);
    expect(next.vol).toBeGreaterThan(0.059);
    expect(next.vol).toBeLessThan(0.0601);
  });

  it('eşit oyuncular: kazanan alır, kaybeden verir; beraberlikte puan değişmez', () => {
    const a = DEFAULT_GLICKO;
    const won = rateGame(a, a, 1);
    expect(won.white.rating).toBeGreaterThan(1500);
    expect(won.black.rating).toBeLessThan(1500);
    expect(won.white.rating - 1500).toBeCloseTo(1500 - won.black.rating, 6);
    const drawn = rateGame(a, a, 0.5);
    expect(drawn.white.rating).toBeCloseTo(1500, 6);
    expect(drawn.white.rd).toBeLessThan(350);
  });

  it('yeni oyuncu çok, oturmuş oyuncu az değişir; geçici puan sapmayla belirlenir', () => {
    const fresh = update(DEFAULT_GLICKO, [{ opponent: DEFAULT_GLICKO, score: 1 }]);
    const settled = update({ rating: 1500, rd: 60, vol: 0.06 }, [{ opponent: DEFAULT_GLICKO, score: 1 }]);
    expect(fresh.rating - 1500).toBeGreaterThan(settled.rating - 1500);
    expect(isProvisional(DEFAULT_GLICKO)).toBe(true);
    expect(isProvisional({ rating: 1500, rd: 80, vol: 0.06 })).toBe(false);
  });

  it('uzun ara sapmayı büyütür, en çok 350', () => {
    const p = { rating: 1700, rd: 60, vol: 0.06 };
    expect(aged(p, 30).rd).toBeGreaterThan(60);
    expect(aged(p, 100_000).rd).toBe(350);
    expect(aged(p, 0)).toBe(p);
  });
});

describe('puan kategorileri', () => {
  it('standart satranç süreye göre, varyantlar kendi puanına; süresiz puansız', () => {
    expect(speedOf('1+0')).toBe('bullet');
    expect(speedOf('3+2')).toBe('blitz');
    expect(speedOf('5+0')).toBe('blitz');
    expect(speedOf('10+0')).toBe('rapid');
    expect(speedOf('15+10')).toBe('rapid');
    expect(speedOf('none')).toBeNull();
    expect(ratingCategory('standard', '3+2')).toBe('blitz');
    expect(ratingCategory('jester', '1+0')).toBe('variant:jester');
    expect(ratingCategory('jester', 'none')).toBeNull();
    expect(ratingCategory('yok', '3+2')).toBeNull();
    expect(allCategories()).toEqual([
      'bullet',
      'blitz',
      'rapid',
      'classical',
      'variant:burokrat',
      'variant:jester',
      'variant:diplomat',
    ]);
  });
});
