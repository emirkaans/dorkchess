import { describe, expect, it } from 'vitest';
import { createGame, playSan } from '../src/engine/game.ts';
import { toFen } from '../src/engine/notation.ts';
import { getVariant } from '../src/engine/variants/index.ts';
import { MAX_GAMES, exportPgn, importPgn, replay, storeGame } from '../src/storage/games.ts';
import type { SavedGame } from '../src/storage/games.ts';

const jester = getVariant('jester');

function sample(): SavedGame {
  const g = playSan(jester, createGame(jester), 'e4', 'e5', 'Nc3', 'Nc6', 'Jf3');
  return {
    id: 'x',
    date: '2026-10-09T10:00:00.000Z',
    variantId: 'jester',
    mode: 'Bilgisayara karşı',
    white: 'İnsan',
    black: 'Usta (4)',
    result: '*',
    termination: '',
    startFen: jester.startPosition,
    moves: g.moves.map((m) => m.san),
  };
}

describe('oyun kaydı', () => {
  it('PGN benzeri metin: başlıkta Variant, numaralı hamleler, sonuç', () => {
    const text = exportPgn(sample());
    expect(text).toContain('[Variant "jester"]');
    expect(text).toContain('[Date "2026.10.09"]');
    expect(text).toContain('[Black "Usta (4)"]');
    expect(text).toContain('1. e4 e5 2. Nc3 Nc6 3. Jf3 *');
  });

  it('dışa aktarılan metin içe aktarılınca aynı oyun', () => {
    const g = sample();
    const { game, states } = importPgn(exportPgn(g));
    expect(game.variantId).toBe('jester');
    expect(game.moves).toEqual(g.moves);
    expect(game.white).toBe('İnsan');
    expect(states).toHaveLength(6);
    expect(toFen(jester, states[5].position)).toBe(toFen(jester, replay(g)[5].position));
  });

  it('içe aktarmada yasal olmayan hamle reddedilir', () => {
    expect(() => importPgn('[Variant "standard"]\n\n1. e4 e5 2. Ke3 *')).toThrow(/Geçersiz hamle: Ke3/);
    expect(() => importPgn('[Variant "yok"]\n\n1. e4 *')).toThrow(/Bilinmeyen varyant/);
  });

  it('sonuç etiketi yoksa motorun sonucu kullanılır (mat)', () => {
    const { game } = importPgn('[Variant "standard"]\n\n1. f3 e5 2. g4 Qh4#');
    expect(game.result).toBe('0-1');
  });

  it(`en fazla ${MAX_GAMES} oyun saklanır, eskiler silinir`, () => {
    let list: SavedGame[] = [];
    for (let i = 0; i < MAX_GAMES + 5; i++) list = storeGame({ ...sample(), id: String(i) }, list);
    expect(list).toHaveLength(MAX_GAMES);
    expect(list[0].id).toBe(String(MAX_GAMES + 4));
    expect(list.at(-1)!.id).toBe('5');
  });
});
