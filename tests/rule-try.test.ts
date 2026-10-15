import { describe, expect, it } from 'vitest';
import { createGame, listVariants, parseSquare } from '../src/engine/index.ts';
import { tasksOf } from '../src/ui/TryDiagram.tsx';

describe('kural kartında kendin dene', () => {
  it('her varyantın her örneği oynanabilir bir konum; görevler örneğin oklarından gelir', () => {
    let withTask = 0;
    for (const v of listVariants()) {
      for (const ex of v.rules.examples) {
        const state = createGame(v, ex.fen);
        const tasks = tasksOf(v, state, ex);
        const arrows = ex.arrows.map(([a, b]) => `${parseSquare(a)}-${parseSquare(b)}`);
        for (const m of tasks) expect(arrows).toContain(`${m.from}-${m.to}`);
        if (tasks.length) withTask++;
      }
    }
    // Most examples ask for a move; a few show a move the rule forbids.
    expect(withTask).toBeGreaterThan(0);
  });
});
