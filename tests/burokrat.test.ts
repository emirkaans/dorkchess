import { describe, expect, it } from 'vitest';
import { parseSquare as sq, squareName } from '../src/engine/board.ts';
import { createGame, isInsufficientMaterial, playSan } from '../src/engine/game.ts';
import { isInCheck, legalMoves, legalMovesFrom, perft } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import { burokrat as v, getVariant, listVariants } from '../src/engine/variants/index.ts';

const targets = (fen: string, from: string) =>
  legalMovesFrom(v, parseFen(v, fen), sq(from)).map((m) => squareName(m.to)).sort();

describe('registry', () => {
  it('varyantlar kayıtlı', () => {
    expect(listVariants().map((x) => x.id)).toContain('burokrat');
    expect(getVariant('burokrat')).toBe(v);
    expect(() => getVariant('yok')).toThrow();
  });
});

describe('Bürokrat', () => {
  it('başlangıç konumu: g1/g8 Bürokrat, FEN harfi U/u', () => {
    const pos = parseFen(v, v.startPosition);
    expect(pos.board[sq('g1')]).toEqual({ type: 'u', color: 'w' });
    expect(pos.board[sq('g8')]).toEqual({ type: 'u', color: 'b' });
    expect(pos.board[sq('b1')]).toEqual({ type: 'n', color: 'w' });
    expect(toFen(v, pos)).toBe(v.startPosition);
    expect(perft(v, pos, 1)).toBe(18);
    expect(perft(v, pos, 2)).toBe(324);
  });

  it('boş komşu karelere gider, dolu karelere gidemez, hiçbir şey yiyemez', () => {
    const fen = '4k3/8/8/3p4/3U4/3P4/8/4K3 w - - 0 1';
    expect(targets(fen, 'd4')).toEqual(['c3', 'c4', 'c5', 'e3', 'e4', 'e5']);
    expect(legalMovesFrom(v, parseFen(v, fen), sq('d4')).every((m) => m.captured === undefined)).toBe(true);
  });

  it("hiçbir taş (vezir, piyon, şah, at) Bürokrat'ın karesine hamle üretemez", () => {
    // Siyah: Ve8 (e hattı), d5 piyonu (çapraz), Şf5 (komşu), Af6 (at sıçrayışı)
    const pos = parseFen(v, '4q3/8/5n2/3p1k2/4U3/8/8/7K b - - 0 1');
    const moves = legalMoves(v, pos);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.to === sq('e4'))).toBe(false);
    // Vezir Bürokrat'ın arkasına da geçemez (bloklayıcı)
    expect(moves.some((m) => m.from === sq('e8') && m.to === sq('e3'))).toBe(false);
  });

  it("Bürokrat şah çekmez; rakip şah Bürokrat'ın yanına gidebilir", () => {
    const pos = parseFen(v, '8/8/4k3/8/4U3/8/8/4K3 b - - 0 1');
    expect(isInCheck(v, pos)).toBe(false);
    expect(targets('8/8/4k3/8/4U3/8/8/4K3 b - - 0 1', 'e6')).toEqual(
      expect.arrayContaining(['d5', 'e5', 'f5']),
    );
    expect(isInCheck(v, parseFen(v, '8/8/8/3k4/4U3/8/8/4K3 b - - 0 1'))).toBe(false);
  });

  it('kale tarafından çekilen şahı araya girerek kurtarır', () => {
    const fen = 'k3r3/8/8/8/8/8/3U4/4K3 w - - 0 1';
    const pos = parseFen(v, fen);
    expect(isInCheck(v, pos)).toBe(true);
    expect(targets(fen, 'd2')).toEqual(['e2', 'e3']);
  });

  it('bağlı (pinned) Bürokrat hattan çıkamaz', () => {
    expect(targets('k3r3/8/8/8/8/8/4U3/4K3 w - - 0 1', 'e2')).toEqual(['e3']);
    expect(targets('k7/8/8/b7/8/8/3U4/4K3 w - - 0 1', 'd2')).toEqual(['c3']);
  });

  it('kayan taşların yolunu keser', () => {
    expect(targets('4k3/8/8/8/U7/8/8/R3K3 w - - 0 1', 'a1')).toEqual(['a2', 'a3', 'b1', 'c1', 'd1']);
  });

  it('Bürokrat hamleleri pat hesabında sayılır', () => {
    expect(createGame(v, 'k7/8/8/8/8/8/5q2/U6K w - - 0 1').result).toBeNull();
    expect(createGame(v, 'k7/8/8/8/8/8/5q2/7K w - - 0 1').result).toEqual({ reason: 'stalemate', winner: null });
  });

  it('Bürokrat hamlesi 50 hamle sayacını artırır', () => {
    const g = playSan(v, createGame(v, '4k2r/8/8/8/8/8/8/U3K3 w - - 10 30'), 'Ub2');
    expect(g.position.halfmove).toBe(11);
    expect(g.moves[0].san).toBe('Ub2');
  });

  it("piyon Bürokrat'a terfi edemez", () => {
    const promos = legalMovesFrom(v, parseFen(v, '8/P7/8/8/8/8/8/k6K w - - 0 1'), sq('a7')).map((m) => m.promotion);
    expect(promos).not.toContain('u');
    expect(promos).toHaveLength(4);
  });

  it('yetersiz materyalde Bürokrat yok sayılır', () => {
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/U3K3 w - - 0 1'))).toBe(true);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/4u3/8/8/8/8/8/UN2K3 w - - 0 1'))).toBe(true);
    expect(isInsufficientMaterial(v, parseFen(v, '4k3/8/8/8/8/8/8/UR2K3 w - - 0 1'))).toBe(false);
  });

  it('Bürokrat bloke ettiği için rok yapılamaz, kalkınca yapılır', () => {
    const g = createGame(v, 'r3k2r/8/8/8/8/8/8/R3K1UR w KQkq - 0 1');
    expect(legalMoves(v, g.position).some((m) => m.castle === 'K')).toBe(false);
    const g2 = playSan(v, g, 'Uf2', 'Kd8');
    expect(legalMoves(v, g2.position).some((m) => m.castle === 'K')).toBe(true);
  });
});
