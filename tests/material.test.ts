import { describe, expect, it } from 'vitest';
import { createGame, listVariants } from '../src/engine/index.ts';
import { materialDiff } from '../src/ui/material.ts';

describe('taş farkı', () => {
  const v = listVariants()[0];

  it('başta fark yok', () => {
    const d = materialDiff(v, createGame(v).position);
    expect(d.extra).toEqual({ w: [], b: [] });
    expect(d.lead).toEqual({ w: 0, b: 0 });
  });

  it('karşılıklı alınan taşlar birbirini götürür; yalnızca fark ve puan kalır', () => {
    // White has a knight more; both sides lost a pawn.
    const p = createGame(v, 'rnbqkb1r/ppp1pppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1').position;
    const d = materialDiff(v, p);
    expect(d.extra.w).toEqual(['n']);
    expect(d.extra.b).toEqual([]);
    expect(d.lead).toEqual({ w: 3, b: 0 });
  });

  it('bir taraf fazla taşa, öbürü puana önde olabilir', () => {
    // White: queen gone. Black: both rooks gone. White has two rooks more, Black a queen more.
    const p = createGame(v, '1nbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQ - 0 1').position;
    const d = materialDiff(v, p);
    expect(d.extra.w).toEqual(['r', 'r']);
    expect(d.extra.b).toEqual(['q']);
    expect(d.lead.w).toBe(1);
    expect(d.lead.b).toBe(0);
  });
});
