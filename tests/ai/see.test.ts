import { describe, expect, it } from 'vitest';
import { staticExchange } from '../../src/ai/search.ts';
import { parseSquare as sq } from '../../src/engine/board.ts';
import { findMove, createGame } from '../../src/engine/game.ts';
import { getVariant } from '../../src/engine/variants/index.ts';

const see = (id: string, fen: string, from: string, to: string) => {
  const v = getVariant(id);
  const g = createGame(v, fen);
  return staticExchange(v, g.position, findMove(v, g, sq(from), sq(to))!);
};

describe('SEE (takas analizi)', () => {
  it('korunmayan piyonu almak +100, korunan piyonu kaleyle almak -400', () => {
    expect(see('standard', '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1', 'd1', 'd5')).toBe(100);
    expect(see('standard', '4k3/8/4p3/3p4/8/8/8/3RK3 w - - 0 1', 'd1', 'd5')).toBe(-400);
  });

  it('karşılıklı alışveriş: arka arkaya iki kale, siyahın bir kalesi korunuyor', () => {
    // Rxd5 Rxd5 Rxd5: beyaz piyon + kale kazanır, kale kaybeder = +100.
    expect(see('standard', '3rk3/8/8/3p4/8/8/3R4/3RK3 w - - 0 1', 'd2', 'd5')).toBe(100);
  });

  it('bağlı taşlar hesaba katılmaz (klasik SEE: hızlı, yasallığa bakmaz)', () => {
    // Siyah at e7 aslında e1 kalesiyle şaha bağlı; SEE onu yine de geri alan taş sayar.
    expect(see('standard', '4k3/4n3/8/3p4/8/8/8/3QR1K1 w - - 0 1', 'd1', 'd5')).toBe(100 - 900);
  });

  it('Bürokrat yeme yapamaz: yalnızca Bürokrat korursa taş bedava', () => {
    expect(see('burokrat', '4k3/8/4u3/3p4/8/8/8/3QK3 w - - 0 1', 'd1', 'd5')).toBe(100);
  });

  it('Diplomat bölgesindeki taş geri alamaz', () => {
    // Siyah kale c5, b4'teki beyaz Diplomatın bölgesinde (d5 değil): d5'i geri alamaz (yeme yasağı).
    expect(see('diplomat', '4k3/8/8/2rp4/1D6/8/8/3QK3 w - - 0 1', 'd1', 'd5')).toBe(100);
  });
});

describe('SEE kontrol: aura yokken aynı taş geri alır', () => {
  it('Diplomat 3. yatayda (pasif): kale d5\'i geri alır, vezir kaybı', () => {
    expect(see('diplomat', '4k3/8/8/2rp4/8/1D6/8/3QK3 w - - 0 1', 'd1', 'd5')).toBe(100 - 900);
  });
});
