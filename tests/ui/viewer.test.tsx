// @vitest-environment happy-dom
// Game viewer with analysis: the fake bot scores every position; the viewer
// must show the eval bar, the graph, the best-move arrow and mark the blunder.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThinkOptions } from '../../src/ai/client.ts';

/** Scripted answers: score (side to move's view) per position index, best move e2e4-ish placeholder. */
const script = vi.hoisted(() => ({ scores: [] as number[], calls: 0 }));
vi.mock('../../src/ai/client.ts', () => {
  class BotCancelled extends Error {}
  class BotClient {
    async think(opts: ThinkOptions) {
      const i = opts.state.moves.length;
      script.calls++;
      const { legalMoves } = await import('../../src/engine/legality.ts');
      const { getVariant } = await import('../../src/engine/variants/index.ts');
      const move = legalMoves(getVariant(opts.variantId), opts.state.position)[0];
      return { move, score: script.scores[i] ?? 0, depth: 1, nodes: 1 };
    }
    stop() {}
    dispose() {}
  }
  return { BotClient, BotCancelled };
});

const { GameViewer } = await import('../../src/ui/GameViewer.tsx');
const { createGame, playSan } = await import('../../src/engine/game.ts');
const { getVariant } = await import('../../src/engine/variants/index.ts');

afterEach(cleanup);

/** All states of a short game (each with its previous chain). */
function statesOf(...sans: string[]) {
  const v = getVariant('standard');
  const out = [createGame(v)];
  for (const san of sans) out.push(playSan(v, out[out.length - 1], san));
  return out;
}

describe('oyun izleyici ve analiz', () => {
  it('analiz: puanlar, çubuk, grafik, en iyi hamle oku ve hata işareti', async () => {
    const states = statesOf('e4', 'e5', 'Qh5', 'Ke7');
    // Side-to-move scores: White +0.3, Black -0.3, White +0.4, Black -0.4, then White +3.0
    // (Black's Ke7 threw away ~2.6 pawns: a blunder).
    script.scores = [30, -30, 40, -40, 300];
    script.calls = 0;
    render(<GameViewer variant={getVariant('standard')} states={states} />);
    expect(document.querySelector('.eval-bar')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Analiz et' })));
    await act(async () => {
      for (let i = 0; i < 20 && script.calls < states.length; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(script.calls).toBe(states.length);
    expect(document.querySelector('.eval-bar')).not.toBeNull();
    expect(document.querySelector('.eval-graph polyline')).not.toBeNull();
    // Shown position is the last one: White to move, +3.0.
    expect(document.querySelector('.eval-text')?.textContent).toBe('+3.0');
    expect(document.querySelectorAll('svg.arrows line')).toHaveLength(1);
    const marked = [...document.querySelectorAll('.mv.blunder')].map((b) => b.textContent);
    expect(marked).toEqual(['Ke7??']);
    expect(screen.queryByRole('button', { name: /Analiz et/ })).toBeNull(); // bitti
  });

  it('gezinme: hamle listesinden ve düğmelerle', () => {
    render(<GameViewer variant={getVariant('standard')} states={statesOf('e4', 'e5')} />);
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Başa' }));
    expect(screen.getByText('0/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'e5' }));
    expect(screen.getByText('2/2')).toBeTruthy();
  });
});
