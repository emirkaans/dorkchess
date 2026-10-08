import { describe, expect, it } from 'vitest';
import { parseSquare as sq, squareName } from '../src/engine/board.ts';
import { createGame, playSan, positionKey, setupStartPosition } from '../src/engine/game.ts';
import { isInCheck, legalMoves, legalMovesFrom, perft } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import { jester as v } from '../src/engine/variants/index.ts';
import { JESTER, jesterForm } from '../src/engine/variants/jester.ts';

const targets = (fen: string, from: string) =>
  legalMovesFrom(v, parseFen(v, fen), sq(from)).map((m) => squareName(m.to)).sort();

describe('Jester: formlar', () => {
  it('başlangıç: g1/g8 Jester, FEN gidiş-dönüş', () => {
    const pos = parseFen(v, v.startPosition);
    expect(pos.board[sq('g1')]).toEqual({ type: 'j', color: 'w' });
    expect(pos.board[sq('g8')]).toEqual({ type: 'j', color: 'b' });
    expect(toFen(v, pos)).toBe(v.startPosition);
    expect(perft(v, pos, 1)).toBe(20);
  });

  it('oyunun ilk hamlesinde beyaz Jester at gibi hareket eder', () => {
    expect(targets(v.startPosition, 'g1')).toEqual(['f3', 'h3']);
    const g = playSan(v, createGame(v), 'Jf3');
    expect(g.moves[0].san).toBe('Jf3');
  });

  it('rakip fil oynayınca fil gibi hareket edip yer', () => {
    expect(targets('4k3/8/8/1p6/8/8/8/4KJ2 w - - 0 1 -b', 'f1')).toEqual(['b5', 'c4', 'd3', 'e2', 'g2', 'h3']);
    // Oyun içinde: siyah fil oynar, beyaz Jester fil formuna geçer
    const g = playSan(v, createGame(v), 'e3', 'e6', 'Nc3', 'Nc6', 'Jf3', 'Bc5');
    expect(jesterForm(g.position, 'w')).toBe('b');
    expect(legalMovesFrom(v, g.position, sq('f3')).map((m) => squareName(m.to)).sort()).toEqual(
      ['c6', 'd5', 'e2', 'e4', 'g4', 'h5'],
    );
  });

  it('rakip kale oynayınca kale gibi hareket edip yer', () => {
    expect(targets('k7/8/3p4/8/3J4/8/8/4K3 w - - 0 1 -r', 'd4')).toEqual(
      ['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'd6', 'e4', 'f4', 'g4', 'h4'].sort(),
    );
    const cap = legalMovesFrom(v, parseFen(v, 'k7/8/3p4/8/3J4/8/8/4K3 w - - 0 1 -r'), sq('d4')).find(
      (m) => m.to === sq('d6'),
    );
    expect(cap?.captured).toBe('p');
  });

  it('rakip piyon oynayınca: tek ileri, çapraz yeme; çift adım, en passant, terfi yok', () => {
    expect(targets('k7/8/8/2p1p3/3J4/8/8/K7 w - - 0 1 -p', 'd4')).toEqual(['c5', 'd5', 'e5']);
    expect(targets('k7/8/8/8/8/8/3J4/K7 w - - 0 1 -p', 'd2')).toEqual(['d3']); // çift adım yok
    expect(targets('k7/8/8/3pJ3/8/8/8/K7 w - d6 0 1 -p', 'e5')).toEqual(['e6']); // en passant yok
    const last = legalMovesFrom(v, parseFen(v, '2r4k/3J4/8/8/8/8/8/K7 w - - 0 1 -p'), sq('d7'));
    expect(last.map((m) => squareName(m.to)).sort()).toEqual(['c8', 'd8']);
    expect(last.every((m) => m.promotion === undefined)).toBe(true); // terfi yok
    // Siyah Jester piyon formunda aşağı doğru ilerler
    expect(targets('k7/8/8/3j4/2P5/8/8/K7 b - - 0 1 p-', 'd5')).toEqual(['c4', 'd4']);
  });

  it('rakip rok yapınca şah formu (yiyebilir, rok yapamaz)', () => {
    let g = createGame(v, 'r3k2r/8/8/8/8/8/7p/R3K1J1 b kq - 0 1 --');
    g = playSan(v, g, 'O-O');
    expect((g.position.extra as { lastMoved: { b: string } }).lastMoved.b).toBe('k');
    expect(jesterForm(g.position, 'w')).toBe('k');
    expect(legalMovesFrom(v, g.position, sq('g1')).map((m) => squareName(m.to)).sort()).toEqual(
      ['f1', 'f2', 'g2', 'h1', 'h2'],
    );
    expect(legalMovesFrom(v, g.position, sq('g1')).find((m) => m.to === sq('h2'))?.captured).toBe('p');
  });

  it("rakip Jester oynayınca, o Jester'in hamle anındaki formunu alır", () => {
    // Beyaz Jester vezir formunda (siyahın son taşı vezir), siyah Jester piyon formunda.
    let g = createGame(v, 'k3j3/8/8/8/8/8/8/K5J1 w - - 0 1 pq');
    expect(jesterForm(g.position, 'w')).toBe('q');
    expect(jesterForm(g.position, 'b')).toBe('p');
    g = playSan(v, g, 'Jd4');
    expect(jesterForm(g.position, 'b')).toBe('q');
    expect(JESTER.badge!(g.position, 'b')!.title).toBe('Rakibin son taşı: Vezir');
    // Zincir: siyah Jester vezir formuyla oynar, beyaz Jester de vezir formunda kalır.
    g = playSan(v, g, 'Je5');
    expect(jesterForm(g.position, 'w')).toBe('q');
  });

  it('piyon formundaki Jester oynayınca rakip Jester piyon formuna geçer', () => {
    const g = playSan(v, createGame(v, 'k3j3/8/8/8/8/8/6J1/K7 w - - 0 1 -p'), 'Jg3');
    expect(jesterForm(g.position, 'b')).toBe('p');
  });

  it('başlangıçta (rakip henüz oynamadıysa) at formu', () => {
    const g = playSan(v, createGame(v), 'Jf3');
    expect(jesterForm(g.position, 'b')).toBe('n');
  });

  it('Jester yenebilir ve SAN harfi J', () => {
    const g = playSan(v, createGame(v, '4k3/8/8/8/8/5j2/8/4K1N1 w - - 0 1 -b'), 'Nxf3');
    expect(g.moves[0].san).toBe('Nxf3');
    expect(g.position.board[sq('f3')]).toEqual({ type: 'n', color: 'w' });
  });

  it('rozet: güncel formu ve rakibin son taşını gösterir', () => {
    const pos = parseFen(v, 'k7/8/8/8/3J4/8/8/4K3 w - - 0 1 -q');
    expect(JESTER.badge!(pos, 'w')!.title).toBe('Rakibin son taşı: Vezir');
    expect(JESTER.badge!(parseFen(v, v.startPosition), 'w')!.title).toContain('varsayılan');
  });
});

describe('Jester: yasallık', () => {
  it('vezir oynamak siyah Jesteri vezir yapar; şah vezir hattında açık kalacaksa vezir hamlesi yasal değil', () => {
    const fen = 'k3j3/8/8/8/8/8/8/3QK3 w - - 0 1 --';
    expect(targets(fen, 'd1')).toEqual(['e2']); // yalnızca e hattını kapatan hamle
    expect(targets(fen, 'e1').length).toBeGreaterThan(0); // şah hamleleri serbest
  });

  it('kale oynamak siyah Jesteri kale yapar: h hattını kapatmayan kale hamleleri yasal değil', () => {
    expect(targets('k6j/8/8/8/8/8/1R6/7K w - - 0 1 --', 'b2')).toEqual(['h2']);
  });

  it('at oynamak siyah Jesteri at yapar: Jesteri yemeyen at hamleleri yasal değil', () => {
    const fen = 'k7/8/8/8/8/3j4/1N6/4K3 w - - 0 1 k-';
    expect(isInCheck(v, parseFen(v, fen))).toBe(false); // şu an şah formunda, e1'e saldırmıyor
    expect(targets(fen, 'b2')).toEqual(['d3']);
  });

  it('piyon oynamak siyah Jesteri piyon yapar: piyon hamlesi yasal değil', () => {
    const fen = 'k7/8/8/8/8/8/3j3P/4K3 w - - 0 1 n-';
    expect(targets(fen, 'h2')).toEqual([]);
    expect(legalMoves(v, parseFen(v, fen)).length).toBeGreaterThan(0);
  });

  it('şah göstergesi: Jesterin görünen formu sıradaki oyuncunun son taşına göre', () => {
    expect(isInCheck(v, parseFen(v, '6k1/8/8/8/8/8/8/j6K w - - 0 1 r-'))).toBe(true);
    expect(isInCheck(v, parseFen(v, '6k1/8/8/8/8/8/8/j6K w - - 0 1 b-'))).toBe(false);
  });

  it('Jester formunun dahil olduğu mat', () => {
    // Siyah Jester a1'de kale formunda (beyazın son taşı kale) şah çekiyor; g1/g2/h2 kapalı.
    const g = createGame(v, '8/8/8/8/8/6p1/5k2/j6K w - - 0 1 r-');
    expect(isInCheck(v, g.position)).toBe(true);
    expect(g.result).toEqual({ reason: 'checkmate', winner: 'b' });
  });

  it('Jester formunun dahil olduğu pat', () => {
    // Aynı diziliş, Jester fil formunda: şah yok ama yasal hamle yok.
    const g = createGame(v, '8/8/8/8/8/6p1/5k2/j6K w - - 0 1 b-');
    expect(isInCheck(v, g.position)).toBe(false);
    expect(g.result).toEqual({ reason: 'stalemate', winner: null });
  });

  it('şah çekiliyken başka türde taş oynayarak Jesterin formunu değiştirmek şahtan kurtarır', () => {
    // Kale formundaki Jester şah çekiyor; piyon oynamak onu piyon formuna sokar.
    const g = createGame(v, '6k1/8/8/8/8/8/6PP/j6K w - - 0 1 r-');
    expect(isInCheck(v, g.position)).toBe(true);
    expect(g.result).toBeNull();
    expect(targets('6k1/8/8/8/8/8/6PP/j6K w - - 0 1 r-', 'h2')).toEqual(['h3', 'h4']);
  });
});

describe('Jester: konum hash', () => {
  it('aynı taş dizilişi, farklı Jester formu = farklı hash', () => {
    const a = parseFen(v, 'k7/8/8/8/3J4/8/8/4K3 w - - 0 1 -q');
    const b = parseFen(v, 'k7/8/8/8/3J4/8/8/4K3 w - - 0 1 -r');
    expect(positionKey(v, a)).not.toBe(positionKey(v, b));
  });

  it('aynı form (başlangıç = at) aynı hash; tahtada Jester yoksa form önemsiz', () => {
    const a = parseFen(v, 'k7/8/8/8/3J4/8/8/4K3 w - - 0 1 --');
    const b = parseFen(v, 'k7/8/8/8/3J4/8/8/4K3 w - - 0 1 -n');
    expect(positionKey(v, a)).toBe(positionKey(v, b));
    const c = parseFen(v, 'k7/8/8/8/3Q4/8/8/4K3 w - - 0 1 -q');
    const d = parseFen(v, 'k7/8/8/8/3Q4/8/8/4K3 w - - 0 1 -r');
    expect(positionKey(v, c)).toBe(positionKey(v, d));
  });
});

describe('Jester: başlangıç seçimi', () => {
  it('her oyuncu için 7 seçenek: vezir + sol/sağ kale, fil, at', () => {
    const [w, b] = v.setup!.questions;
    expect(w.color).toBe('w');
    expect(b.color).toBe('b');
    expect(w.options.map((o) => o.id)).toEqual(['d', 'a', 'h', 'c', 'f', 'b', 'g']);
    expect(w.options.find((o) => o.id === 'a')!.label).toBe('Sol kale (a1)');
    // Sol/sağ oyuncunun kendi oturduğu yere göre
    expect(b.options.find((o) => o.id === 'a')!.label).toBe('Sağ kale (a8)');
    expect(b.options.find((o) => o.id === 'h')!.label).toBe('Sol kale (h8)');
  });

  it('varsayılan seçim (g atları) mevcut başlangıç konumunu verir', () => {
    expect(setupStartPosition(v)).toBe(v.startPosition);
  });

  it('seçilen taşın yerine Jester konur; kale seçilirse o kanatta rok hakkı düşer', () => {
    expect(setupStartPosition(v, { w: 'd', b: 'h' })).toBe(
      'rnbqkbnj/pppppppp/8/8/8/8/PPPPPPPP/RNBJKBNR w KQq - 0 1 --',
    );
    expect(setupStartPosition(v, { w: 'a', b: 'c' })).toBe(
      'rnjqkbnr/pppppppp/8/8/8/8/PPPPPPPP/JNBQKBNR w Kkq - 0 1 --',
    );
  });

  it('seçilen konumdan oyun oynanabilir', () => {
    const g = createGame(v, setupStartPosition(v, { w: 'd', b: 'b' }));
    expect(g.position.board[sq('d1')]).toEqual({ type: 'j', color: 'w' });
    expect(g.position.board[sq('b8')]).toEqual({ type: 'j', color: 'b' });
    expect(perft(v, g.position, 2)).toBeGreaterThan(0);
  });

  it('geçersiz seçim reddedilir', () => {
    expect(() => setupStartPosition(v, { w: 'e' })).toThrow();
  });
});
