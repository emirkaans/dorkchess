import { describe, expect, it } from 'vitest';
import { createGame, listVariants, playSan } from '../src/engine/index.ts';
import { MATE } from '../src/ai/evaluate.ts';
import { parseInfo, uciPosition, uciScore, uciToLine } from '../src/ai/stockfish.ts';

describe('stockfish bağlantısı', () => {
  it('UCI puanları bizim biçime çevrilir: santipiyon ve mat', () => {
    expect(uciScore('cp', 34)).toBe(34);
    expect(uciScore('mate', 1)).toBe(MATE - 1);
    expect(uciScore('mate', 3)).toBe(MATE - 5);
    expect(uciScore('mate', -2)).toBe(-(MATE - 4));
  });

  it('info satırı okunur; sınır puanları ve ikinci çizgiler atlanır', () => {
    const i = parseInfo('info depth 18 seldepth 24 multipv 1 score cp 974 nodes 120000 nps 900000 pv g2g4 f6g4 h3g4');
    expect(i).toEqual({ depth: 18, score: 974, nodes: 120000, pv: ['g2g4', 'f6g4', 'h3g4'] });
    expect(parseInfo('info depth 18 multipv 2 score cp 10 pv a2a3')).toBeNull();
    expect(parseInfo('info depth 18 score cp 10 lowerbound pv a2a3')).toBeNull();
    expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
  });

  it('UCI hamlesi kare numaralarına çevrilir', () => {
    expect(uciToLine('e2e4')).toEqual({ from: 12, to: 28 });
    expect(uciToLine('e7e8q')).toEqual({ from: 52, to: 60, promotion: 'q' });
  });

  it('pozisyon oyunun başından hamlelerle gönderilir (tekrarlar sayılsın)', () => {
    const v = listVariants()[0];
    const s = playSan(v, createGame(v), 'e4', 'e5', 'Nf3');
    expect(uciPosition(s)).toBe(
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3',
    );
  });
});
