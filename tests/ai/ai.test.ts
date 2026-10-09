import { describe, expect, it } from 'vitest';
import { chooseMove } from '../../src/ai/search.ts';
import { levelConfig, LEVELS, botTimeMs, acceptsDraw } from '../../src/ai/levels.ts';
import { createRng } from '../../src/ai/rng.ts';
import { evaluate } from '../../src/ai/evaluate.ts';
import { squareName } from '../../src/engine/board.ts';
import { createGame, makeMove } from '../../src/engine/game.ts';
import { legalMoves } from '../../src/engine/legality.ts';
import { getVariant } from '../../src/engine/variants/index.ts';
import type { Move } from '../../src/engine/types.ts';

const VARIANTS = ['standard', 'burokrat', 'jester', 'diplomat'] as const;
/** Level 4–5 searches are cut short in tests; the positions are simple. */
const FAST = { 4: 400, 5: 400 } as Record<number, number>;

/** Adds a harmless white special piece on h1 (Jester positions also need the 7th FEN field). */
function withSpecial(id: string, fen: string): string {
  const special: Record<string, string> = { burokrat: 'U', jester: 'J', diplomat: 'D' };
  if (!special[id]) return fen;
  const [placement, ...rest] = fen.split(' ');
  const ranks = placement.split('/');
  ranks[7] = ranks[7].replace(/(\d)$/, (d) => (d === '1' ? special[id] : String(Number(d) - 1) + special[id]));
  return [ranks.join('/'), ...rest, ...(id === 'jester' ? ['--'] : [])].join(' ');
}

const uci = (m: Move) => squareName(m.from) + squareName(m.to);

const isLegalChoice = (id: string, fen: string, m: Move) =>
  legalMoves(getVariant(id), createGame(getVariant(id), fen).position).some(
    (x) => x.from === m.from && x.to === m.to && x.promotion === m.promotion,
  );

describe('seviyeler', () => {
  it('5 seviye, adları ve süreleri tek yapılandırmada', () => {
    expect(LEVELS.map((l) => [l.level, l.name, l.timeLimitMs])).toEqual([
      [1, 'Çaylak', 100],
      [2, 'Mahalle', 300],
      [3, 'Kulüp', 700],
      [4, 'Usta', 500],
      [5, 'Dork', 950],
    ]);
    expect(() => levelConfig(6)).toThrow();
  });

  it('saatli oyunda bot süresi = min(seviye sınırı, kalan/30 + artış)', () => {
    expect(botTimeMs(5)).toBe(950);
    expect(botTimeMs(5, { remainingMs: 15_000, incrementMs: 0 })).toBe(500);
    expect(botTimeMs(3, { remainingMs: 600_000, incrementMs: 2000 })).toBe(700);
  });

  it('beraberlik teklifi: seviye 3+ -150 altında kabul eder, 1-2 hep reddeder', () => {
    expect(acceptsDraw(1, -900)).toBe(false);
    expect(acceptsDraw(3, -151)).toBe(true);
    expect(acceptsDraw(4, -150)).toBe(false);
  });

  it('tohumlu rastgele üreteç deterministik', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
  });
});

describe('değerlendirme', () => {
  it('başlangıç konumu simetrik: 0', () => {
    for (const id of VARIANTS) {
      const v = getVariant(id);
      expect(evaluate(v, createGame(v).position), id).toBe(0);
    }
  });

  it('sıradaki tarafın bakış açısından; fazla vezir artı', () => {
    const v = getVariant('standard');
    const fen = '4k3/8/8/8/8/8/8/3QK3';
    expect(evaluate(v, createGame(v, `${fen} w - - 0 1`).position)).toBeGreaterThan(800);
    expect(evaluate(v, createGame(v, `${fen} b - - 0 1`).position)).toBeLessThan(-800);
  });
});

describe.each(VARIANTS)('%s — yapay zekâ', (id) => {
  const v = getVariant(id);

  it.each([3, 4, 5])('seviye %i 1 hamlede matı bulur', (level) => {
    const fen = withSpecial(id, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const g = createGame(v, fen);
    const { move } = chooseMove(v, g, level, { seed: 1, timeLimitMs: FAST[level] });
    expect(makeMove(v, g, move).result).toEqual({ reason: 'checkmate', winner: 'w' });
  });

  it.each([3, 4, 5])('seviye %i asılı vezirini bedavaya bırakmaz', (level) => {
    // Beyaz vezir d4'e c5 piyonu saldırıyor.
    const fen = withSpecial(id, '4k3/8/8/2p5/3Q4/8/8/4K3 w - - 0 1');
    for (const seed of [1, 2, 3]) {
      const g = makeMove(
        v,
        createGame(v, fen),
        chooseMove(v, createGame(v, fen), level, { seed, timeLimitMs: FAST[level] }).move,
      );
      expect(
        legalMoves(v, g.position).some((m) => m.captured === 'q'),
        `tohum ${seed}`,
      ).toBe(false);
    }
  });

  it.each([3, 4, 5])('seviye %i bedava vezir yemeyi kaçırmaz', (level) => {
    const fen = withSpecial(id, '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
    for (const seed of [1, 2, 3]) {
      const { move } = chooseMove(v, createGame(v, fen), level, { seed, timeLimitMs: FAST[level] });
      expect(uci(move)).toBe('d1d5');
    }
  });

  it('determinizm: aynı tohum + konum + seviye 1-3 = aynı hamle', () => {
    const g = createGame(v);
    for (const level of [1, 2, 3]) {
      for (const seed of [7, 8]) {
        const a = chooseMove(v, g, level, { seed }).move;
        const b = chooseMove(v, g, level, { seed }).move;
        expect(uci(b), `seviye ${level}`).toBe(uci(a));
      }
    }
  });
});

describe('Jester — bot ve yasallık', () => {
  const v = getVariant('jester');
  // Qxa4 kaleyi alırdı ama siyah Jester'i vezir yapar ve e hattı açık kalır: yasal değil.
  const fen = 'k3j3/8/8/8/r7/8/8/3QK3 w - - 0 1 --';

  it.each([1, 2, 3, 4, 5])("seviye %i yasal liste dışına çıkmaz, Jester'e şah imkânı vermez", (level) => {
    for (const seed of [1, 2, 3, 4]) {
      const { move } = chooseMove(v, createGame(v, fen), level, { seed, timeLimitMs: FAST[level] });
      expect(isLegalChoice('jester', fen, move)).toBe(true);
      expect(uci(move)).not.toBe('d1a4');
    }
  });
});

describe('Diplomat — bot ve aura', () => {
  const v = getVariant('diplomat');

  it.each([1, 2, 3, 4, 5])('seviye %i auradaki taşı yemeye çalışmaz', (level) => {
    // Siyah vezir e4, siyah Diplomat d4'ün aurasında: e1 kalesi onu yiyemez.
    const fen = '7k/8/8/8/3dq3/8/8/K3R3 w - - 0 1';
    for (const seed of [1, 2, 3, 4]) {
      const { move } = chooseMove(v, createGame(v, fen), level, { seed, timeLimitMs: FAST[level] });
      expect(isLegalChoice('diplomat', fen, move)).toBe(true);
      expect(uci(move)).not.toBe('e1e4');
    }
  });

  it.each([3, 4, 5])("seviye %i Diplomat'ı aura dışından yer", (level) => {
    const fen = '7k/8/8/8/3d4/8/8/K2R4 w - - 0 1';
    const { move } = chooseMove(v, createGame(v, fen), level, { seed: 1, timeLimitMs: FAST[level] });
    expect(uci(move)).toBe('d1d4');
    expect(move.captured).toBe('d');
  });
});

describe('süre sınırı', () => {
  it('seviye 4 araması süre sınırını %20den fazla aşmaz', () => {
    const v = getVariant('standard');
    const g = createGame(v, 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w KQ - 0 8');
    const t = performance.now();
    chooseMove(v, g, 4, { seed: 1 });
    expect(performance.now() - t).toBeLessThan(500 * 1.2);
  });

  it('durdurma isteği aramayı keser ama yine yasal bir hamle döner', () => {
    const v = getVariant('standard');
    const g = createGame(v);
    let polls = 0;
    const r = chooseMove(v, g, 5, { seed: 1, shouldStop: () => ++polls > 2 });
    expect(r.depth).toBeGreaterThanOrEqual(1);
    expect(legalMoves(v, g.position).some((m) => m.from === r.move.from && m.to === r.move.to)).toBe(true);
  });
});
