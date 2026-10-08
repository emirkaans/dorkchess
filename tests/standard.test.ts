import { describe, expect, it } from 'vitest';
import { parseSquare as sq, squareName } from '../src/engine/board.ts';
import { createGame, isInsufficientMaterial, makeMove, playSan, undoMove } from '../src/engine/game.ts';
import { isInCheck, legalMoves, legalMovesFrom } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import { standard as v } from '../src/engine/variants/standard.ts';

const targets = (fen: string, from: string) =>
  legalMovesFrom(v, parseFen(v, fen), sq(from)).map((m) => squareName(m.to)).sort();

describe('rok', () => {
  it('her iki yöne rok yapılabilir', () => {
    const g = createGame(v, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castles = legalMoves(v, g.position).filter((m) => m.castle).map((m) => m.castle);
    expect(castles.sort()).toEqual(['K', 'Q']);
    const after = playSan(v, g, 'O-O');
    expect(toFen(v, after.position).split(' ')[0]).toBe('r3k2r/8/8/8/8/8/8/R4RK1');
    expect(after.position.castling).toEqual({ wK: false, wQ: false, bK: true, bQ: true });
  });

  it('şah çekiliyken, geçiş karesi tehdit altındayken veya arada taş varken rok yok', () => {
    expect(targets('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1', 'e1')).not.toContain('c1'); // şah
    expect(targets('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1'); // f1 tehdit
    expect(targets('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1', 'e1')).toContain('c1');
    expect(targets('4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1', 'e1')).not.toContain('c1'); // b1 dolu
    expect(targets('4k3/8/8/8/8/6r1/8/R3K2R w KQ - 0 1', 'e1')).not.toContain('g1'); // hedef tehdit
  });

  it('kale hareket edince / yenince rok hakkı düşer', () => {
    let g = createGame(v, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    g = playSan(v, g, 'Rxa8+');
    expect(g.position.castling).toEqual({ wK: true, wQ: false, bK: true, bQ: false });
  });
});

describe('en passant', () => {
  it('çift adımdan hemen sonra alınabilir, bir hamle sonra alınamaz', () => {
    let g = createGame(v, '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
    g = playSan(v, g, 'd5');
    expect(g.position.ep).toBe(sq('d6'));
    const ep = legalMoves(v, g.position).find((m) => m.enPassant);
    expect(ep).toBeDefined();
    const after = makeMove(v, g, ep!);
    expect(after.position.board[sq('d5')]).toBeNull();
    expect(after.moves.at(-1)!.san).toBe('exd6');

    const later = playSan(v, g, 'Kf2', 'Kd8');
    expect(legalMoves(v, later.position).some((m) => m.enPassant)).toBe(false);
  });

  it('şahı açığa çıkaran en passant yasal değil', () => {
    const pos = parseFen(v, '8/8/8/KPp4r/8/8/8/4k3 w - c6 0 1');
    expect(legalMoves(v, pos).some((m) => m.enPassant)).toBe(false);
  });
});

describe('terfi', () => {
  it('dört seçenek üretilir ve uygulanır', () => {
    const g = createGame(v, '8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promos = legalMovesFrom(v, g.position, sq('a7')).map((m) => m.promotion).sort();
    expect(promos).toEqual(['b', 'n', 'q', 'r']);
    const after = playSan(v, g, 'a8=N');
    expect(after.position.board[sq('a8')]).toEqual({ type: 'n', color: 'w' });
    expect(after.moves[0].san).toBe('a8=N');
  });
});

describe('oyun sonu', () => {
  it("mat (Fool's mate)", () => {
    const g = playSan(v, createGame(v), 'f3', 'e5', 'g4', 'Qh4#');
    expect(g.result).toEqual({ reason: 'checkmate', winner: 'b' });
    expect(g.moves.at(-1)!.san).toBe('Qh4#');
  });

  it('pat', () => {
    const g = createGame(v, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(isInCheck(v, g.position)).toBe(false);
    expect(g.result).toEqual({ reason: 'stalemate', winner: null });
  });

  it('üç kez tekrar', () => {
    let g = createGame(v);
    g = playSan(v, g, 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1');
    expect(g.result).toBeNull();
    g = playSan(v, g, 'Ng8');
    expect(g.result).toEqual({ reason: 'threefold', winner: null });
  });

  it('50 hamle kuralı', () => {
    let g = createGame(v, '4k3/8/8/8/8/8/R7/4K3 w - - 98 80');
    g = playSan(v, g, 'Ra3');
    expect(g.result).toBeNull();
    g = playSan(v, g, 'Kd7');
    expect(g.position.halfmove).toBe(100);
    expect(g.result).toEqual({ reason: 'fifty-move', winner: null });
  });

  it('piyon hamlesi ve taş alma 50 hamle sayacını sıfırlar', () => {
    const g = playSan(v, createGame(v, '4k3/8/8/8/8/8/4P3/4K3 w - - 40 60'), 'e4');
    expect(g.position.halfmove).toBe(0);
  });

  it('50. hamlede mat, beraberliğe üstün gelir', () => {
    const g = playSan(v, createGame(v, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80'), 'Ra8#');
    expect(g.result).toEqual({ reason: 'checkmate', winner: 'w' });
  });

  it('yetersiz materyal: K-K, K+F-K, K+A-K', () => {
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/4K3 w - - 0 1'))).toBe(true);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'))).toBe(true);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/1n2K3 w - - 0 1'))).toBe(true);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1'))).toBe(false);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'))).toBe(false);
    const g = playSan(v, createGame(v, '4k3/8/8/8/8/8/8/r3K3 w - - 0 1'), 'Ke2', 'Kd7');
    expect(g.result).toBeNull();
    const g2 = playSan(v, createGame(v, '4k3/8/8/8/8/8/3r4/4K3 w - - 0 1'), 'Kxd2');
    expect(g2.result).toEqual({ reason: 'insufficient', winner: null });
  });
});

describe('notasyon ve geri al', () => {
  it('SAN ayrıştırma (dosya / sıra)', () => {
    const g = createGame(v, '3k4/8/8/8/8/4K3/8/R6R w - - 0 1');
    expect(playSan(v, g, 'Rad1').moves[0].san).toBe('Rad1+');
    const g2 = createGame(v, '4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
    expect(playSan(v, g2, 'R1a3').moves[0].san).toBe('R1a3');
  });

  it('geri al önceki duruma döner', () => {
    const g0 = createGame(v);
    const g1 = playSan(v, g0, 'e4');
    expect(undoMove(g1)).toBe(g0);
  });

  it('yasal olmayan hamle reddedilir', () => {
    const g = createGame(v);
    expect(() => makeMove(v, g, { from: sq('e2'), to: sq('e5'), piece: 'p' })).toThrow();
  });
});
