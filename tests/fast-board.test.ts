// The fast search board must agree with the reference engine move for move.
// New variants are covered automatically (every registered variant is tested);
// the targeted positions below exercise the rules random games rarely reach.

import { describe, expect, it } from 'vitest';
import { FastBoard } from '../src/engine/fast/board.ts';
import { perft } from '../src/engine/legality.ts';
import { parseFen } from '../src/engine/notation.ts';
import { getVariant, listVariants } from '../src/engine/variants/index.ts';
import type { VariantDefinition } from '../src/engine/types.ts';
import { allStarts, compare, lockstep, positionsOf } from './engine-parity.ts';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POS5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';

/** FEN from a map of square -> piece letter (empty board otherwise). */
function fenOf(pieces: Record<string, string>, rest: string): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces['abcdefgh'[f] + (r + 1)];
      if (p) {
        row += (empty || '') + p;
        empty = 0;
      } else empty++;
    }
    rows.push(row + (empty || ''));
  }
  return `${rows.join('/')} ${rest}`;
}

const FORMS = ['-', 'p', 'n', 'b', 'r', 'q', 'k'];

/** Hand-picked positions per variant: the rules random games seldom reach. */
const TARGETED: Record<string, () => string[]> = {
  standard: () => [
    KIWIPETE,
    POS3,
    POS4,
    POS5,
    '8/8/8/8/k2Pp2Q/8/8/3K4 b - d3 0 1', // en passant would expose the king
    '4k3/8/8/8/8/8/2b5/R3K2R w KQ - 0 1', // queen-side transit square attacked
    '4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', // king-side transit attacked
    '4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1', // promotions both ways
    'r1n1k3/1P6/8/8/8/8/8/4K3 w q - 0 1', // capture-promotions
    '4k3/8/8/8/8/8/6p1/4K2R b K - 0 1', // black promotes with capture of a castling rook
  ],
  burokrat: () => [
    'k3r3/8/8/8/8/8/3U4/4K3 w - - 0 1', // Bürokrat blocks a check
    'k7/8/8/b7/8/8/3U4/4K3 w - - 0 1', // pinned Bürokrat
    '4q2k/8/8/8/4U3/8/8/4K3 b - - 0 1', // queen cannot take it nor pass it
    'rnbqkbur/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBUR w KQkq - 0 1',
  ],
  // Every pair of Jester forms (White's and Black's last moved piece), both sides to move.
  jester: () =>
    FORMS.flatMap((w) =>
      FORMS.flatMap((bl) => ['w', 'b'].map((turn) => `4k3/1p6/3j4/8/2P5/4J3/6P1/4K3 ${turn} - - 0 1 ${w}${bl}`)),
    ).concat([
      '2r4k/3J4/8/8/8/8/8/K7 w - - 0 1 -p', // pawn form on the last rank
      'k3j3/8/8/8/r7/8/8/3QK3 w - - 0 1 --', // a queen move would give the Jester the queen
      'k7/8/8/8/8/3j4/1N6/4K3 w - - 0 1 k-',
    ]),
  // A Diplomat on every square of ranks 3-6, with pieces around it (zone on / off).
  diplomat: () => {
    const out: string[] = [];
    for (const f of 'bcdefg') {
      for (const r of [3, 4, 5, 6]) {
        const right = String.fromCharCode(f.charCodeAt(0) + 1);
        const up = r + 1;
        out.push(
          fenOf({ [f + r]: 'D', [right + r]: 'n', [right + up]: 'b', a1: 'K', h8: 'k', ['a' + r]: 'R' }, 'w - - 0 1'),
          fenOf({ [f + r]: 'd', [right + r]: 'N', [f + up]: 'P', a1: 'K', h8: 'k', ['h' + r]: 'r' }, 'b - - 0 1'),
        );
      }
    }
    return out;
  },
};

describe('hızlı tahta: standart perft', () => {
  const v = getVariant('standard');
  it.each([
    ['başlangıç', v.startPosition, [20, 400, 8902, 197281]],
    ['Kiwipete', KIWIPETE, [48, 2039, 97862]],
    ['konum 3', POS3, [14, 191, 2812, 43238]],
    ['konum 4', POS4, [6, 264, 9467]],
    ['konum 5', POS5, [44, 1486, 62379]],
  ] as const)('%s', (_name, fen, counts) => {
    const b = new FastBoard(v).load(parseFen(v, fen));
    counts.forEach((expected, i) => expect(b.perft(i + 1), `derinlik ${i + 1}`).toBe(expected));
  });
});

describe.each(listVariants().map((v) => [v.id, v] as const))('hızlı tahta = motor: %s', (id, v: VariantDefinition) => {
  // Random games from every start the variant's setup allows, followed by the
  // fast board through make only (never reloaded).
  const run = lockstep(v, allStarts(v), 16, 11);
  const targeted = positionsOf(v, TARGETED[id]?.() ?? []);

  it('kilit adımlı oyunlar: her hamlede hamleler, şah, oyun sonu, hash ve durum aynı', () => {
    expect(run.errors).toEqual([]);
    expect(run.positions.length).toBeGreaterThan(500);
  });

  it('hedefli konumlar birebir aynı', () => {
    const b = new FastBoard(v);
    const fresh = new FastBoard(v);
    const errors = targeted.flatMap((pos) => {
      b.load(pos);
      return compare(v, b, pos, fresh);
    });
    expect(errors).toEqual([]);
  });

  it('perft(3) birebir aynı (örnek konumlarda)', () => {
    const b = new FastBoard(v);
    const sample = [...targeted.slice(0, 6), ...run.positions.filter((_, i) => i % 97 === 0).slice(0, 10)];
    for (const pos of sample) {
      b.load(pos);
      expect(b.perft(3)).toBe(perft(v, pos, 3));
    }
  });

  it('hamle yap/geri al sonrası konum ve hash aynen geri gelir', () => {
    const b = new FastBoard(v);
    for (const pos of [...targeted, ...run.positions.filter((_, i) => i % 7 === 0)]) {
      b.load(pos);
      const before = Array.from(b.sq).join() + b.castling + b.ep + b.extra.join() + b.hashLo + b.hashHi;
      for (const m of b.legalMoves()) {
        b.make(m);
        b.unmake();
      }
      expect(Array.from(b.sq).join() + b.castling + b.ep + b.extra.join() + b.hashLo + b.hashHi).toBe(before);
    }
  });
});

describe('uyum testi kendini doğruluyor', () => {
  it('Jester için 49 başlangıç seçimi de kapsanıyor', () => {
    expect(allStarts(getVariant('jester'))).toHaveLength(49);
  });
});
