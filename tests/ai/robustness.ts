import { describe, expect, it } from 'vitest';
import { playMatch } from '../../src/ai/match.ts';
import { getVariant } from '../../src/engine/variants/index.ts';

/**
 * 20 seeded bot-vs-bot games per level (1 and 2) for one variant. Every move goes
 * through makeMove, which throws on an illegal move, so a finished game means
 * every move was legal. One file per variant lets Vitest run them in parallel.
 */
export function robustnessSuite(variantId: string): void {
  describe(`${variantId} — sağlamlık (bot vs bot)`, () => {
    it.each([1, 2])('seviye %i: 20 tam oyun hatasız biter', (level) => {
      const v = getVariant(variantId);
      for (let seed = 1; seed <= 20; seed++) {
        const r = playMatch(v, { white: level, black: level, seed });
        expect(r.final.result !== null || r.reason === 'limit', `tohum ${seed}`).toBe(true);
        expect(r.plies).toBe(r.final.moves.length);
      }
    });
  });
}
