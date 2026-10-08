import { describe, expect, it } from 'vitest';
import { parseSquare as sq, squareName } from '../src/engine/board.ts';
import { createGame, isInsufficientMaterial, makeMove, playSan } from '../src/engine/game.ts';
import { isInCheck, legalMoves, legalMovesFrom, perft } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import { auraSquares } from '../src/engine/variants/diplomat.ts';
import { diplomat as v, getVariant, listVariants } from '../src/engine/variants/index.ts';
import type { GameState } from '../src/engine/types.ts';

const targets = (fen: string, from: string) =>
  legalMovesFrom(v, parseFen(v, fen), sq(from)).map((m) => squareName(m.to)).sort();

const capturesIn = (pos: GameState['position']) =>
  legalMoves(v, pos)
    .filter((m) => m.captured !== undefined)
    .map((m) => `${squareName(m.from)}x${squareName(m.to)}`)
    .sort();

const captures = (fen: string) => capturesIn(parseFen(v, fen));

const aura = (fen: string) => auraSquares(parseFen(v, fen)).map(squareName).sort();

describe('Diplomat registry', () => {
  it('tek varyant olarak kayıtlı; eski A/B/C versiyonları yok', () => {
    const ids = listVariants().map((x) => x.id);
    expect(getVariant('diplomat')).toBe(v);
    expect(ids.filter((id) => id.startsWith('diplomat'))).toEqual(['diplomat']);
  });
});

describe('Diplomat — temel', () => {
  it('başlangıç: g1/g8 Diplomat, FEN harfi D/d', () => {
    const pos = parseFen(v, v.startPosition);
    expect(pos.board[sq('g1')]).toEqual({ type: 'd', color: 'w' });
    expect(pos.board[sq('g8')]).toEqual({ type: 'd', color: 'b' });
    expect(toFen(v, pos)).toBe(v.startPosition);
    expect(perft(v, pos, 1)).toBe(18);
    expect(perft(v, pos, 2)).toBe(324);
  });

  it('boş komşu karelere gider, dolu karelere gidemez, yeme yapamaz', () => {
    const fen = '4k3/8/8/3p4/3D4/3P4/8/4K3 w - - 0 1';
    expect(targets(fen, 'd4')).toEqual(['c3', 'c4', 'c5', 'e3', 'e4', 'e5']);
    expect(legalMovesFrom(v, parseFen(v, fen), sq('d4')).every((m) => m.captured === undefined)).toBe(true);
  });

  it('Diplomat şah çekmez', () => {
    expect(isInCheck(v, parseFen(v, '8/8/8/3k4/3D4/8/8/K7 b - - 0 1'))).toBe(false);
  });

  it("piyon Diplomat'a terfi edemez; yetersiz materyalde Diplomat yok sayılır", () => {
    expect(v.promotionTypes).not.toContain('d');
    expect(isInsufficientMaterial(v, parseFen(v, '7k/8/8/8/3D4/8/8/K7 w - - 0 1'))).toBe(true);
  });
});

describe('Diplomat — aura yalnızca 4. ve 5. yatayda', () => {
  it('aynı dizilim: 4. ve 5. yatayda aura var, 3. ve 6. yatayda yok', () => {
    // Diplomat dX, yanında siyah taş eX, e1'deki beyaz kale e hattından bakıyor.
    for (const piece of ['n', 'r', 'b']) {
      expect(captures(`7k/8/8/8/8/3D${piece}3/8/K3R3 w - - 0 1`), `3. yatay, ${piece}`).toEqual(['e1xe3']);
      expect(captures(`7k/8/8/8/3D${piece}3/8/8/K3R3 w - - 0 1`), `4. yatay, ${piece}`).toEqual([]);
      expect(captures(`7k/8/8/3D${piece}3/8/8/8/K3R3 w - - 0 1`), `5. yatay, ${piece}`).toEqual([]);
      expect(captures(`7k/8/3D${piece}3/8/8/8/8/K3R3 w - - 0 1`), `6. yatay, ${piece}`).toEqual(['e1xe6']);
    }
    expect(aura('7k/8/8/8/8/3D4/8/K7 w - - 0 1')).toEqual([]);
    expect(aura('7k/8/3D4/8/8/8/8/K7 w - - 0 1')).toEqual([]);
  });

  it('d4: aura tam olarak {c4, e4, c5, d5, e5}', () => {
    expect(aura('7k/8/8/8/3D4/8/8/K7 w - - 0 1')).toEqual(['c4', 'c5', 'd5', 'e4', 'e5']);
  });

  it('d5: aura tam olarak {c5, e5, c4, d4, e4}', () => {
    expect(aura('7k/8/8/3D4/8/8/8/K7 w - - 0 1')).toEqual(['c4', 'c5', 'd4', 'e4', 'e5']);
  });

  it('a4 (kenar): aura tam olarak {b4, a5, b5}', () => {
    expect(aura('7k/8/8/8/D7/8/8/K7 w - - 0 1')).toEqual(['a5', 'b4', 'b5']);
  });

  it('3. ve 6. yataydaki komşu karelerde duran taşlar korunmaz ve yeme yapabilir', () => {
    // Diplomat d4: c3'teki siyah at yenebilir, e3'teki beyaz at g4'ü yiyebilir.
    expect(captures('7k/8/8/8/3D2b1/2n1N3/8/K1R5 w - - 0 1')).toEqual(['c1xc3', 'e3xg4']);
    // Diplomat d5: c6'daki siyah at yenebilir.
    expect(captures('7k/8/2n5/3D4/8/8/8/K1R5 w - - 0 1')).toEqual(['c1xc6']);
  });

  it('Diplomat yalnızca aurası yokken pasif sayılır (arayüz soluk çizer)', () => {
    const inactive = v.pieces.d.inactive!;
    for (const [name, expected] of [['d3', true], ['d4', false], ['d5', false], ['d6', true], ['g1', true]] as const) {
      expect(inactive(parseFen(v, v.startPosition), sq(name)), name).toBe(expected);
    }
  });
});

describe('Diplomat — aura kuralları', () => {
  it('aurada duran taş yeme yapamaz', () => {
    // Beyaz kale d5, d4'teki Diplomatın aurasında; h5'teki atı yiyemez.
    expect(captures('7k/8/8/3R3n/3D4/8/8/K7 w - - 0 1')).toEqual([]);
    expect(captures('7k/8/8/3R3n/8/3D4/8/K7 w - - 0 1')).toEqual(['d5xh5']);
  });

  it('aurada duran şah da yeme yapamaz', () => {
    // Şah e4 aurada; e3'teki korumasız atı alamaz. Diplomat 3. yatayda olunca alır.
    expect(targets('7k/8/8/8/3DK3/4n3/8/8 w - - 0 1', 'e4')).not.toContain('e3');
    expect(targets('7k/8/8/8/4K3/3Dn3/8/8 w - - 0 1', 'e4')).toContain('e3');
  });

  it('aurada duran şaha aura dışındaki kale ile şah çekilebilir', () => {
    expect(isInCheck(v, parseFen(v, '4r2k/8/8/8/3DK3/8/8/8 w - - 0 1'))).toBe(true);
  });

  it('aura içindeki şah mat olur', () => {
    // Beyaz şah a4, b5'teki Diplomatın aurasında. Siyah at b6 ve kale h4 çift şah çekiyor;
    // a8 ve h3'teki kaleler kaçış karelerini (a3, a5, b3, b4) tutuyor.
    const fen = 'r6k/8/1n6/1D6/K6r/7r/8/8 w - - 0 1';
    expect(aura(fen)).toContain('a4');
    expect(createGame(v, fen).result).toEqual({ reason: 'checkmate', winner: 'b' });
  });

  it('Diplomat aura dışından (kale, fil, at) yenebilir; aurasındaki taş tarafından yenemez', () => {
    // c4'teki beyaz kale siyah Diplomatın aurasında: yiyemez. d1 kalesi ve f3 atı dışarıdan yer.
    expect(captures('7k/8/8/8/2Rd4/5N2/8/K2R4 w - - 0 1')).toEqual(['d1xd4', 'f3xd4']);
    expect(captures('7k/8/8/8/3d4/8/8/K5B1 w - - 0 1')).toEqual(['g1xd4']);
  });

  it('Diplomat yenildiği anda aura kalkar; sonraki hamlede auradaki taş yenebilir', () => {
    let g = createGame(v, '7k/8/8/8/3dn3/8/8/K2RR3 w - - 0 1');
    expect(capturesIn(g.position)).toEqual(['d1xd4']);
    g = makeMove(v, g, legalMoves(v, g.position).find((m) => m.to === sq('d4'))!);
    expect(auraSquares(g.position)).toEqual([]);
    g = playSan(v, g, 'Kg8');
    expect(capturesIn(g.position)).toEqual(['d4xe4', 'e1xe4']);
  });

  it('Diplomat 4. yataydan 3. yataya inince aura kalkar', () => {
    let g = createGame(v, '7k/8/8/8/3Dn3/8/8/K3R3 w - - 0 1');
    expect(capturesIn(g.position)).toEqual([]);
    g = playSan(v, g, 'Dd3');
    expect(auraSquares(g.position)).toEqual([]);
    g = playSan(v, g, 'Kg8');
    expect(capturesIn(g.position)).toEqual(['e1xe4']);
  });

  it('en passant aura kuralına uyar', () => {
    const epAfterD5 = (fen: string) => {
      const g = playSan(v, createGame(v, fen), 'd5');
      return legalMovesFrom(v, g.position, sq('e5')).some((m) => m.enPassant);
    };
    expect(epAfterD5('7k/3p4/8/4P3/8/8/8/D6K b - - 0 1')).toBe(true); // aura yok
    expect(epAfterD5('7k/3p4/8/4P3/2D5/8/8/7K b - - 0 1')).toBe(false); // yenen piyon (d5) aurada
    expect(epAfterD5('7k/3p4/8/4P3/5D2/8/8/7K b - - 0 1')).toBe(false); // yiyen piyon (e5) aurada
    expect(epAfterD5('7k/3p4/2D5/4P3/8/8/8/7K b - - 0 1')).toBe(true); // c6'daki Diplomat pasif
  });
});

describe('Diplomat — arayüz için vurgulu kareler', () => {
  it('aura içindeki şahın karesi boyanmaz; 4. ve 5. yatay işaretlenir', () => {
    const pos = parseFen(v, '7k/8/8/8/3DK3/8/8/8 w - - 0 1');
    const shown = v.highlight!.squares(pos).map(squareName).sort();
    expect(shown).toEqual(['c4', 'c5', 'd5', 'e5']);
    expect(v.highlight!.ranks).toEqual([3, 4]);
  });

  it('Diplomat 4-5. yatay dışındayken hiçbir kare boyanmaz', () => {
    expect(v.highlight!.squares(parseFen(v, v.startPosition))).toEqual([]);
  });
});
