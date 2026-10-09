import { describe, expect, it } from 'vitest';
import { createRng } from '../src/ai/rng.ts';
import { squareName } from '../src/engine/board.ts';
import { FastBoard, moveFrom, movePromo, moveTo } from '../src/engine/fast/board.ts';
import { createGame, makeMove } from '../src/engine/game.ts';
import { isInCheck, legalMoves, perft } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import { getVariant, listVariants } from '../src/engine/variants/index.ts';
import type { Move, Position, VariantDefinition } from '../src/engine/types.ts';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POS5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';

const refKey = (m: Move) => squareName(m.from) + squareName(m.to) + (m.promotion ?? '');
const fastKey = (b: FastBoard, m: number) =>
  squareName(moveFrom(m)) + squareName(moveTo(m)) + (movePromo(m) >= 0 ? b.types[movePromo(m)].letter : '');

/** Random games with the reference engine; returns every position visited. */
function samplePositions(v: VariantDefinition, games: number, seed: number): Position[] {
  const rng = createRng(seed);
  const out: Position[] = [];
  for (let g = 0; g < games; g++) {
    let state = createGame(v);
    for (let ply = 0; ply < 160 && !state.result; ply++) {
      out.push(state.position);
      const moves = legalMoves(v, state.position);
      // Prefer captures now and then so material comes off and endgames appear.
      const caps = moves.filter((m) => m.captured);
      const m = caps.length && rng.next() < 0.3 ? rng.pick(caps) : rng.pick(moves);
      state = makeMove(v, state, m);
    }
  }
  return out;
}

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

describe.each(listVariants().map((v) => [v.id, v] as const))('hızlı tahta = motor: %s', (_id, v) => {
  const positions = samplePositions(v, 12, 7);

  it('rastgele konumlarda yasal hamleler ve şah durumu birebir aynı', () => {
    const b = new FastBoard(v);
    for (const pos of positions) {
      b.load(pos);
      const ref = legalMoves(v, pos).map(refKey).sort();
      const fast = b.legalMoves().map((m) => fastKey(b, m)).sort();
      expect(fast, JSON.stringify(pos.extra)).toEqual(ref);
      expect(b.inCheck()).toBe(isInCheck(v, pos));
    }
  });

  it('perft(3) birebir aynı (örnek konumlarda)', () => {
    const b = new FastBoard(v);
    for (let i = 0; i < positions.length; i += Math.ceil(positions.length / 12)) {
      b.load(positions[i]);
      expect(b.perft(3)).toBe(perft(v, positions[i], 3));
    }
  });

  it('hamle yap/geri al sonrası konum ve hash aynen geri gelir; artımlı hash doğru', () => {
    const b = new FastBoard(v);
    const fresh = new FastBoard(v);
    for (const pos of positions.slice(0, 120)) {
      b.load(pos);
      const before = Array.from(b.sq).join() + b.castling + b.ep + b.extra.join();
      const [lo, hi] = [b.hashLo, b.hashHi];
      for (const m of b.legalMoves()) {
        expect(b.make(m)).toBe(true);
        // Incremental hash equals a from-scratch hash of the same position.
        const ref = legalMoves(v, pos).find((x) => refKey(x) === fastKey(fresh.load(pos), m))!;
        const next = makeMove(v, createGame(v, toFen(v, pos)), ref).position;
        fresh.load(next);
        expect([b.hashLo, b.hashHi, b.keyLo()]).toEqual([fresh.hashLo, fresh.hashHi, fresh.keyLo()]);
        b.unmake();
      }
      expect(Array.from(b.sq).join() + b.castling + b.ep + b.extra.join()).toBe(before);
      expect([b.hashLo, b.hashHi]).toEqual([lo, hi]);
    }
  });
});
