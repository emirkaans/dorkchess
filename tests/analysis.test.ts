import { describe, expect, it } from 'vitest';
import { classifyMoves, formatScore, graphValue, terminalScore, toWhite, whiteShare } from '../src/ai/analysis.ts';
import { MATE } from '../src/ai/evaluate.ts';
import { createGame, playSan } from '../src/engine/game.ts';
import { getVariant } from '../src/engine/variants/index.ts';

describe('analiz yardımcıları', () => {
  it('puanlar beyazın bakışına çevrilir', () => {
    expect(toWhite(120, 'w')).toBe(120);
    expect(toWhite(120, 'b')).toBe(-120);
  });

  it('biten konum: mat kazanana, beraberlik 0, devam eden null', () => {
    const v = getVariant('standard');
    const mate = playSan(v, createGame(v), 'f3', 'e5', 'g4', 'Qh4#');
    expect(terminalScore(mate)).toBe(-MATE);
    expect(terminalScore(createGame(v))).toBeNull();
    expect(terminalScore(createGame(v, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe(0); // pat
  });

  it('gösterim: piyon cinsinden ve mat sayısı', () => {
    expect(formatScore(134)).toBe('+1.3');
    expect(formatScore(-40)).toBe('-0.4');
    expect(formatScore(0)).toBe('0.0');
    expect(formatScore(MATE - 5)).toBe('#3'); // 5 ply = beyaz 3. hamlesinde mat eder
    expect(formatScore(-(MATE - 2))).toBe('#-1');
    expect(formatScore(MATE)).toBe('#');
  });

  it('çubuk payı ve grafik değeri sınırlı', () => {
    expect(whiteShare(0)).toBeCloseTo(0.5);
    expect(whiteShare(400)).toBeCloseTo(10 / 11);
    expect(whiteShare(MATE - 3)).toBe(1);
    expect(graphValue(5000)).toBe(800);
    expect(graphValue(-(MATE - 1))).toBe(-800);
  });

  it('hatalar: oynayan tarafın kaybına göre (2+ piyon hata, 1+ piyon yanlışlık)', () => {
    // Konum puanları (beyazın bakışı); hamleler sırayla beyaz, siyah, beyaz, ...
    const evals = [20, 30, 260, 250, 400, null, 0];
    const turns = ['w', 'b', 'w', 'b', 'w', 'b', 'w'] as const;
    expect(classifyMoves(evals, [...turns])).toEqual([
      null, // beyaz: 20 -> 30, kazanç
      'blunder', // siyah: 30 -> 260, siyah 2,3 piyon kaybetti
      null, // beyaz: 260 -> 250, 0,1 piyon
      'mistake', // siyah: 250 -> 400, siyah 1,5 piyon kaybetti
      null, // sonraki konum analiz edilmedi
      null,
    ]);
  });

  it('mat puanları karşılaştırmada sınırlanır (mat kaçırmak hata sayılır, ama sonsuz değil)', () => {
    expect(classifyMoves([MATE - 3, 50], ['w', 'b'])).toEqual(['blunder']);
    expect(classifyMoves([MATE - 3, MATE - 5], ['w', 'b'])).toEqual([null]);
  });
});
