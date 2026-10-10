// @vitest-environment happy-dom
// Import (PGN, FEN, links) and export (PGN, links) of games and positions.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ai/client.ts', () => {
  class BotCancelled extends Error {}
  class BotClient {
    think() {
      return new Promise(() => {});
    }
    stop() {}
    dispose() {}
  }
  return { BotClient, BotCancelled };
});

const { parseImport, pgnOf, gameLinkOf } = await import('../../src/ui/ShareTools.tsx');
const { AnalysisPage } = await import('../../src/ui/AnalysisPage.tsx');
const { createGame, playSan, toFen } = await import('../../src/engine/index.ts');
const { getVariant } = await import('../../src/engine/variants/index.ts');
const { encodePosition } = await import('../../src/storage/share.ts');

afterEach(cleanup);

const v = getVariant('standard');
const statesOf = (...sans: string[]) => {
  const out = [createGame(v)];
  for (const san of sans) out.push(playSan(v, out[out.length - 1], san));
  return out;
};

describe('içe / dışa aktarma', () => {
  it('PGN ve oyun linki dışa aktarılır, geri okununca aynı oyun çıkar', () => {
    const states = statesOf('e4', 'e5', 'Nf3');
    const pgn = pgnOf(v, states, { white: 'Ayşe', black: 'Bora' });
    expect(pgn).toContain('[White "Ayşe"]');
    expect(pgn).toContain('1. e4 e5 2. Nf3 *');
    const fromPgn = parseImport(pgn, 'standard');
    expect(fromPgn.states.at(-1)!.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);

    const fromLink = parseImport(gameLinkOf(v, states), 'standard');
    expect(fromLink.states).toHaveLength(4);
  });

  it('FEN ve konum linki okunur; bozuk metin hata verir', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const line = parseImport(fen, 'standard');
    expect(line.states).toHaveLength(1);
    expect(toFen(v, line.states[0].position).startsWith('r3k2r/8/8/8/8/8/8/R3K2R w KQkq')).toBe(true);
    expect(parseImport(`https://punkchess.com/${encodePosition('standard', fen)}`, 'standard').states).toHaveLength(1);
    expect(() => parseImport('1. e4 e5 2. Ke3', 'standard')).toThrow();
  });

  it('analiz tahtası: İçe aktar penceresinden PGN yüklenir ve analiz modunda açılır', async () => {
    render(<AnalysisPage initialVariantId="standard" />);
    fireEvent.click(screen.getByRole('button', { name: 'İçe aktar' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'PGN, FEN ya da link' }), {
      target: { value: '1. d4 d5 2. c4 e6' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yükle' })));
    expect(screen.getByRole('heading', { name: 'Analiz tahtası' })).toBeTruthy();
    expect([...document.querySelectorAll('.moves .mv')].map((b) => b.textContent)).toEqual(['d4', 'd5', 'c4', 'e6']);
    expect(screen.getByText('Paylaş / dışa aktar')).toBeTruthy();
  });

  it('analiz tahtası: başka ekrandan gelen oyun verilen hamlede açılır', () => {
    const states = statesOf('e4', 'c5', 'Nf3');
    render(<AnalysisPage initialVariantId="standard" seed={{ key: 1, variantId: 'standard', states, cursor: 2 }} />);
    expect(document.querySelector('.replay-pos')?.textContent).toBe('2/3');
    expect(document.querySelector('.moves .mv.current')?.textContent).toBe('c5');
  });
});
