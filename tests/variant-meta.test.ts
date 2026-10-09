import { describe, expect, it } from 'vitest';
import { parseFen } from '../src/engine/notation.ts';
import { listVariants } from '../src/engine/variants/index.ts';

describe('varyant meta verisi', () => {
  it.each(listVariants().map((v) => [v.id, v] as const))('%s: her taşın değeri var', (_id, v) => {
    for (const type of v.pieceTypes) expect(v.pieceValues[type], type).toBeTypeOf('number');
    expect(v.pieceValues.k).toBe(0);
  });

  it('başlangıç değerleri şartnamedeki gibi', () => {
    const values = Object.fromEntries(listVariants().map((v) => [v.id, v.pieceValues]));
    expect(values.standard).toEqual({ p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 });
    expect(values.burokrat.u).toBe(100);
    expect(values.jester.j).toBe(300);
    expect(values.diplomat.d).toBe(200);
  });

  it('evaluateExtra: Diplomat bölge bonusu, Bürokrat kalkan bonusu', () => {
    const [bur, dip] = ['burokrat', 'diplomat'].map((id) => listVariants().find((v) => v.id === id)!);
    // Diplomat d4 aktif, bölgesinde iki beyaz taş (c4, e5) ve bir siyah taş (d5).
    expect(dip.evaluateExtra!(parseFen(dip, '7k/8/8/3pP3/2PD4/8/8/K7 w - - 0 1'), 'w')).toBe(50);
    // Diplomat d3: pasif.
    expect(dip.evaluateExtra!(parseFen(dip, '7k/8/8/8/2P5/3D4/8/K7 w - - 0 1'), 'w')).toBe(0);
    // İki Bürokrat şaha bitişik, biri değil.
    expect(bur.evaluateExtra!(parseFen(bur, '7k/8/8/8/8/8/UU6/K5U1 w - - 0 1'), 'w')).toBe(30);
    expect(bur.evaluateExtra!(parseFen(bur, '7k/8/8/8/8/8/UU6/K5U1 w - - 0 1'), 'b')).toBe(0);
  });
});
