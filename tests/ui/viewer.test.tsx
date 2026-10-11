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

  it('varyant: tahtada başka hamle yan dal açar, ana hat korunur; ana hat yapılır ve silinir', () => {
    // happy-dom has no layout: give the board a size so pointer positions map to squares.
    const BOARD = 400;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const size = this.classList.contains('board') ? BOARD : 0;
      return {
        left: 0,
        top: 0,
        x: 0,
        y: 0,
        width: size,
        height: size,
        right: size,
        bottom: size,
        toJSON() {},
      } as DOMRect;
    });
    Element.prototype.setPointerCapture ??= () => {};
    const click = (sq: string) => {
      const board = document.querySelector('.viewer .board')!;
      const at = {
        clientX: (sq.charCodeAt(0) - 97 + 0.5) * (BOARD / 8),
        clientY: (7 - (sq.charCodeAt(1) - 49) + 0.5) * (BOARD / 8),
      };
      fireEvent.pointerDown(board, { ...at, button: 0, pointerId: 1 });
      fireEvent.pointerUp(board, { ...at, button: 0, pointerId: 1 });
    };
    const main = () => [...document.querySelectorAll('.tree-row .mv')].map((b) => b.textContent);
    const variations = () => [...document.querySelectorAll('.tree-var')].map((v) => v.textContent);

    render(<GameViewer variant={getVariant('standard')} states={statesOf('e4', 'e5', 'Nf3')} />);
    fireEvent.click(screen.getByRole('button', { name: 'e5' }));
    click('f2');
    click('f4');
    expect(main()).toEqual(['e4', 'e5', 'Nf3']);
    expect(variations()).toEqual(['2.f4']);
    expect(document.querySelector('.mv.current')?.textContent).toBe('f4');
    // The variation goes on.
    click('e5');
    click('f4');
    expect(variations()).toEqual(['2.f4exf4']);

    fireEvent.click(screen.getByRole('button', { name: 'Ana hat yap' }));
    expect(main()).toEqual(['e4', 'e5', 'f4', 'exf4']);
    expect(variations()).toEqual(['2.Nf3']);

    fireEvent.click(screen.getByRole('button', { name: 'Nf3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buradan sonrasını sil' }));
    expect(variations()).toEqual([]);
    expect(main()).toEqual(['e4', 'e5', 'f4', 'exf4']);
    rect.mockRestore();
  });
});
