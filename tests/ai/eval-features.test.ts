import { describe, expect, it } from 'vitest';
import { features, fromVector, linearEval, toVector } from '../../src/ai/eval-features.ts';
import { EVAL_PARAMS } from '../../src/ai/eval-params.ts';
import { evaluateBoard, phaseWeight } from '../../src/ai/evaluate.ts';
import { createRng } from '../../src/ai/rng.ts';
import { FastBoard } from '../../src/engine/fast/board.ts';
import { createGame, makeMove } from '../../src/engine/game.ts';
import { legalMoves } from '../../src/engine/legality.ts';
import { listVariants } from '../../src/engine/variants/index.ts';

describe('değerlendirme özellikleri (tuner)', () => {
  it('parametre vektörüne çevirip geri almak aynı parametreleri verir', () => {
    expect(fromVector(toVector(EVAL_PARAMS), EVAL_PARAMS)).toEqual(EVAL_PARAMS);
  });

  it.each(listVariants().map((v) => [v.id, v] as const))('%s: doğrusal biçim değerlendirmeyle aynı', (_id, v) => {
    const rng = createRng(3);
    const vec = toVector(EVAL_PARAMS);
    const b = new FastBoard(v);
    for (let g = 0; g < 6; g++) {
      let state = createGame(v);
      for (let ply = 0; ply < 120 && !state.result; ply++) {
        b.load(state.position);
        const fast = evaluateBoard(b, { mobility: true });
        const white = b.side === 0 ? fast : -fast;
        expect(Math.abs(linearEval(features(b, EVAL_PARAMS, phaseWeight), vec) - white)).toBeLessThanOrEqual(1);
        state = makeMove(v, state, rng.pick(legalMoves(v, state.position)));
      }
    }
  });
});
