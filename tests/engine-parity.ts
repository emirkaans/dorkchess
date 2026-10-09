// Shared helpers for comparing the fast search board with the reference engine
// (used by tests/fast-board.test.ts and scripts/parity.ts).

import { createRng } from '../src/ai/rng.ts';
import { squareName } from '../src/engine/board.ts';
import { FastBoard, moveFrom, movePromo, moveTo } from '../src/engine/fast/board.ts';
import { createGame, isInsufficientMaterial, makeMove, setupStartPosition } from '../src/engine/game.ts';
import { isInCheck, legalMoves } from '../src/engine/legality.ts';
import { parseFen, toFen } from '../src/engine/notation.ts';
import type { Move, Position, VariantDefinition } from '../src/engine/types.ts';

export const refKey = (m: Move) => squareName(m.from) + squareName(m.to) + (m.promotion ?? '');
export const fastKey = (b: FastBoard, m: number) =>
  squareName(moveFrom(m)) + squareName(moveTo(m)) + (movePromo(m) >= 0 ? b.types[movePromo(m)].letter : '');

/** A start position: the default, or one with random answers to the variant's setup questions. */
export function randomStart(v: VariantDefinition, rng: ReturnType<typeof createRng>): string {
  if (!v.setup) return v.startPosition;
  const answers = Object.fromEntries(v.setup.questions.map((q) => [q.id, rng.pick(q.options).id]));
  return setupStartPosition(v, answers);
}

/** Every start position the variant's setup questions allow (all answer combinations). */
export function allStarts(v: VariantDefinition): string[] {
  if (!v.setup) return [v.startPosition];
  let combos: Record<string, string>[] = [{}];
  for (const q of v.setup.questions) combos = combos.flatMap((c) => q.options.map((o) => ({ ...c, [q.id]: o.id })));
  return [...new Set(combos.map((c) => setupStartPosition(v, c)))];
}

/** Picks a random legal move, preferring captures and promotions now and then (so endgames appear). */
export function randomMove(moves: Move[], rng: ReturnType<typeof createRng>): Move {
  const sharp = moves.filter((m) => m.captured || m.promotion);
  return sharp.length && rng.next() < 0.35 ? rng.pick(sharp) : rng.pick(moves);
}

/**
 * Differences between the fast board (in its current state) and the
 * reference engine's view of `pos`: legal moves, check, game end and the
 * incremental hash against a fresh load. Returns a description per mismatch.
 */
export function compare(v: VariantDefinition, b: FastBoard, pos: Position, fresh: FastBoard): string[] {
  const errors: string[] = [];
  const where = toFen(v, pos);
  const ref = legalMoves(v, pos).map(refKey).sort();
  const fast = b
    .legalMoves()
    .map((m) => fastKey(b, m))
    .sort();
  if (ref.join() !== fast.join()) {
    const missing = ref.filter((m) => !fast.includes(m));
    const extra = fast.filter((m) => !ref.includes(m));
    errors.push(`${where}: hamleler farklı (eksik ${missing.join(' ')} / fazla ${extra.join(' ')})`);
  }
  const check = isInCheck(v, pos);
  if (b.inCheck() !== check) errors.push(`${where}: şah durumu farklı`);
  // Game end: mate / stalemate follow from moves + check; insufficient material separately.
  if (b.insufficientMaterial() !== isInsufficientMaterial(v, pos)) errors.push(`${where}: yetersiz materyal farklı`);
  fresh.load(pos);
  if (b.hashLo !== fresh.hashLo || b.hashHi !== fresh.hashHi || b.keyLo() !== fresh.keyLo()) {
    errors.push(`${where}: artımlı hash farklı`);
  }
  if (Array.from(b.sq).join() !== Array.from(fresh.sq).join() || b.extra.join() !== fresh.extra.join()) {
    errors.push(`${where}: tahta/ekstra durum farklı`);
  }
  if (b.castling !== fresh.castling || b.ep !== fresh.ep || b.side !== fresh.side) {
    errors.push(`${where}: rok/en passant/sıra farklı`);
  }
  return errors;
}

/**
 * Plays random games with the reference engine while the fast board follows
 * the same moves only through make (never reloaded), comparing at every ply.
 */
export function lockstep(
  v: VariantDefinition,
  starts: readonly string[],
  games: number,
  seed: number,
  maxPlies = 160,
): { errors: string[]; positions: Position[] } {
  const rng = createRng(seed);
  const errors: string[] = [];
  const positions: Position[] = [];
  const b = new FastBoard(v);
  const fresh = new FastBoard(v);
  for (let g = 0; g < games && errors.length < 5; g++) {
    let state = createGame(v, starts[g % starts.length]);
    b.load(state.position);
    for (let ply = 0; ply < maxPlies && !state.result && errors.length < 5; ply++) {
      positions.push(state.position);
      errors.push(...compare(v, b, state.position, fresh));
      const m = randomMove(legalMoves(v, state.position), rng);
      const fm = b.legalMoves().find((x) => fastKey(b, x) === refKey(m));
      if (fm === undefined || !b.make(fm)) {
        errors.push(`${toFen(v, state.position)}: ${refKey(m)} hızlı tahtada oynanamadı`);
        break;
      }
      state = makeMove(v, state, m);
    }
  }
  return { errors, positions };
}

/** Parses a list of FENs for `v` (throws on an invalid one, so typos surface). */
export const positionsOf = (v: VariantDefinition, fens: readonly string[]) => fens.map((f) => parseFen(v, f));
