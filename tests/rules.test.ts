import { describe, expect, it } from 'vitest';
import { parseSquare, squareName } from '../src/engine/board.ts';
import { createGame } from '../src/engine/game.ts';
import { isInCheck, legalMoves } from '../src/engine/legality.ts';
import { parseFen } from '../src/engine/notation.ts';
import { getVariant, listVariants } from '../src/engine/variants/index.ts';

const isSquare = (s: string) => /^[a-h][1-8]$/.test(s) && squareName(parseSquare(s)) === s;

describe('kural kartları', () => {
  it.each(listVariants().map((v) => [v.id, v] as const))('%s: başlık, özet, en fazla 6 madde', (_id, v) => {
    expect(v.rules.title.length).toBeGreaterThan(0);
    expect(v.rules.summary.length).toBeGreaterThan(0);
    expect(v.rules.bullets.length).toBeGreaterThan(0);
    expect(v.rules.bullets.length).toBeLessThanOrEqual(6);
  });

  it('her özel varyantta en az 3 örnek', () => {
    for (const id of ['burokrat', 'jester', 'diplomat'])
      expect(getVariant(id).rules.examples.length, id).toBeGreaterThanOrEqual(3);
  });

  it.each(listVariants().map((v) => [v.id, v] as const))(
    '%s: örnek FENleri motor okuyor; vurgular ve oklar geçerli kareler',
    (_id, v) => {
      for (const ex of v.rules.examples) {
        expect(() => parseFen(v, ex.fen), ex.fen).not.toThrow();
        expect(() => createGame(v, ex.fen), ex.fen).not.toThrow();
        for (const s of ex.highlights) expect(isSquare(s), `${ex.fen}: ${s}`).toBe(true);
        for (const [from, to] of ex.arrows) {
          expect(isSquare(from) && isSquare(to), `${ex.fen}: ${from}-${to}`).toBe(true);
          expect(from).not.toBe(to);
        }
        expect(ex.caption.length).toBeGreaterThan(0);
      }
    },
  );

  // Diyagramlar kuralları doğru anlatıyor mu: oklar motorun söylediğiyle uyumlu.
  const legal = (id: string, fen: string, from: string, to: string) => {
    const v = getVariant(id);
    return legalMoves(v, parseFen(v, fen)).some((m) => squareName(m.from) === from && squareName(m.to) === to);
  };

  it('Bürokrat örnekleri motorla uyumlu', () => {
    const [move, , block] = getVariant('burokrat').rules.examples;
    for (const [f, t] of move.arrows) expect(legal('burokrat', move.fen, f, t)).toBe(true);
    expect(legal('burokrat', move.fen, 'd4', 'd5')).toBe(false);
    expect(legal('burokrat', block.fen, 'd2', 'e2')).toBe(true);
  });

  it('Jester örnekleri motorla uyumlu', () => {
    const [bishop, pawn, illegal] = getVariant('jester').rules.examples;
    for (const [f, t] of bishop.arrows) expect(legal('jester', bishop.fen, f, t)).toBe(true);
    for (const [f, t] of pawn.arrows) expect(legal('jester', pawn.fen, f, t)).toBe(true);
    expect(legal('jester', illegal.fen, 'd1', 'a4')).toBe(false);
  });

  it('Diplomat örnekleri motorla uyumlu', () => {
    const v = getVariant('diplomat');
    const [zone, noCapture, inactive, king] = v.rules.examples;
    expect(v.highlight!.squares(parseFen(v, zone.fen)).map(squareName).sort()).toEqual([...zone.highlights].sort());
    expect(legal('diplomat', noCapture.fen, 'd5', 'h5')).toBe(false);
    expect(legal('diplomat', inactive.fen, 'e1', 'e3')).toBe(true);
    expect(isInCheck(v, parseFen(v, king.fen))).toBe(true);
  });
});
