import { describe, expect, it } from 'vitest';
import { parseSquare as sq, squareName } from '../src/engine/board.ts';
import { parseFen } from '../src/engine/notation.ts';
import { premoveTargets } from '../src/engine/premove.ts';
import { getVariant } from '../src/engine/variants/index.ts';

const targets = (id: string, fen: string, from: string) => {
  const v = getVariant(id);
  return premoveTargets(v, parseFen(v, fen), sq(from)).map(squareName).sort();
};

describe('premove hedefleri', () => {
  it('kayan taş aradaki taşları yok sayar (rakip hamlesinden sonra yol açılabilir)', () => {
    // Beyaz kale a1, a3'te kendi piyonu: premove'da a8'e kadar tüm hat hedef.
    const t = targets('standard', '4k3/8/8/8/8/P7/8/R3K3 b Q - 0 1', 'a1');
    expect(t).toEqual(expect.arrayContaining(['a2', 'a3', 'a8', 'b1', 'd1']));
    expect(t).not.toContain('e1'); // kendi şahının karesi asla boşalmaz
  });

  it('piyon: ileri 1-2 kare ve iki çapraz', () => {
    expect(targets('standard', '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', 'e2')).toEqual(['d3', 'e3', 'e4', 'f3']);
  });

  it('rok hakkı varsa şah rok karelerini hedefleyebilir', () => {
    const t = targets('standard', '4k3/8/8/8/8/8/8/R3K2R b KQ - 0 1', 'e1');
    expect(t).toEqual(expect.arrayContaining(['c1', 'g1']));
  });

  it('varyant taşları kendi kalıplarıyla: Bürokrat 1 kare her yöne', () => {
    expect(targets('burokrat', '4k3/8/8/8/3U4/8/8/4K3 b - - 0 1', 'd4')).toEqual([
      'c3',
      'c4',
      'c5',
      'd3',
      'd5',
      'e3',
      'e4',
      'e5',
    ]);
  });
});
