import { describe, expect, it } from 'vitest';
import { createRng } from '../src/ai/rng.ts';
import { createGame, makeMove } from '../src/engine/game.ts';
import { legalMoves } from '../src/engine/legality.ts';
import { toFen } from '../src/engine/notation.ts';
import { getVariant, listVariants } from '../src/engine/variants/index.ts';
import { decodeLink, encodeGame, encodePosition } from '../src/storage/share.ts';

describe('paylaşım linkleri', () => {
  it.each(listVariants().map((v) => [v.id] as const))('%s: oyun linki gidiş-dönüş aynı oyunu verir', (id) => {
    const v = getVariant(id);
    const rng = createRng(5);
    let state = createGame(v);
    for (let i = 0; i < 40 && !state.result; i++) state = makeMove(v, state, rng.pick(legalMoves(v, state.position)));
    const moves = state.moves.map((m) => m.san);
    const link = encodeGame({ variantId: id, startFen: v.startPosition, moves });
    expect(link).toMatch(/^#g=[A-Za-z0-9_-]+$/); // URL'de güvenli karakterler
    const back = decodeLink(link);
    expect(back?.kind).toBe('game');
    if (back?.kind !== 'game') return;
    expect(back.game.moves).toEqual(moves);
    expect(toFen(v, back.states.at(-1)!.position)).toBe(toFen(v, state.position));
  });

  it('özel başlangıç konumu (ör. Jester seçimi) linkte taşınır', () => {
    const fen = 'rnbqkbnj/pppppppp/8/8/8/8/PPPPPPPP/RNBJKBNR w KQq - 0 1 --';
    const back = decodeLink(encodeGame({ variantId: 'jester', startFen: fen, moves: ['e4'] }));
    expect(back?.kind === 'game' && back.game.startFen).toBe(fen);
  });

  it('konum linki', () => {
    const fen = '4k3/8/8/8/3D4/8/8/4K3 w - - 0 1';
    expect(decodeLink(encodePosition('diplomat', fen))).toEqual({ kind: 'position', variantId: 'diplomat', fen });
  });

  it('paylaşım içermeyen hash yok sayılır; bozuk link anlaşılır mesajla reddedilir', () => {
    expect(decodeLink('')).toBeNull();
    expect(decodeLink('#hakkinda')).toBeNull();
    expect(() => decodeLink('#g=@@@')).toThrow(/Link bozuk/);
    expect(() =>
      decodeLink(
        encodeGame({
          variantId: 'standard',
          startFen: getVariant('standard').startPosition,
          moves: ['e4', 'e5', 'Ke2', 'Kh5'],
        }),
      ),
    ).toThrow(/geçersiz hamle: Kh5/);
    const unknown = '#g=' + btoa(JSON.stringify({ v: 'yok', m: '' })).replace(/=+$/, '');
    expect(() => decodeLink(unknown)).toThrow(/Bilinmeyen varyant/);
    expect(() => decodeLink(encodePosition('standard', 'bozuk fen'))).toThrow(/konum geçersiz/);
  });
});
