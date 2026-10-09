// Negamax + alpha-beta search with iterative deepening, quiescence and a
// transposition table. Uses only the engine's general API (legal moves, apply,
// game-end rules, position key), so every variant rule is respected without
// variant-specific code here. No React / DOM imports.

import {
  applyMove,
  isInCheck,
  isInsufficientMaterial,
  isLegal,
  legalMoves,
  positionKey,
  pseudoMoves,
} from '../engine/index.ts';
import type { GameResult, GameState, Move, Position, VariantDefinition } from '../engine/index.ts';
import { MATE, MATE_BOUND, evaluate, mobility } from './evaluate.ts';
import { levelConfig } from './levels.ts';
import { createRng, randomSeed } from './rng.ts';
import type { Rng } from './rng.ts';

const INF = 1_000_000;
/** Transposition table size limit (entries); the table is cleared when full. */
export const TT_LIMIT = 2 ** 18;
/** Safety cap on quiescence depth (check evasions can otherwise chain). */
const MAX_QPLY = 12;
/** Mobility is skipped when the static score is this far outside the alpha-beta bounds. */
const LAZY_MARGIN = 150;

export interface SearchInfo {
  readonly depth: number;
  readonly score: number;
  readonly pv: readonly Move[];
  readonly nodes: number;
}

export interface SearchParams {
  readonly maxDepth: number;
  readonly quiescence: boolean;
  readonly transpositionTable: boolean;
  readonly mobility: boolean;
  readonly timeLimitMs: number;
  /**
   * Which root moves need exact scores: those that may be among the best
   * `topK`, or within `margin` centipawns of the best. The others only get an
   * upper bound (they can't be picked anyway), which keeps alpha-beta pruning
   * at the root.
   */
  readonly rootExact: { readonly topK: number; readonly margin: number };
  /** Polled during the search; returning true aborts it (the last completed depth is used). */
  readonly shouldStop?: () => boolean;
  readonly now?: () => number;
  readonly onInfo?: (info: SearchInfo) => void;
}

export interface ScoredMove {
  readonly move: Move;
  /** Centipawns from the side to move's point of view. */
  readonly score: number;
}

export interface SearchResult {
  /** Root moves of the last completed depth, best first. */
  readonly scores: readonly ScoredMove[];
  readonly depth: number;
  readonly nodes: number;
}

interface TTEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // exact, lower bound, upper bound
  move: Move | undefined;
}

const ABORT = Symbol('abort');

/** Monotonic clock in ms; `performance` exists in browsers, workers and Node, but isn't in the plain ES lib types. */
const defaultNow = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

const sameMove = (a: Move | undefined, b: Move) =>
  !!a && a.from === b.from && a.to === b.to && a.promotion === b.promotion;

/** Mate scores are stored relative to the node, not the root. */
const toTT = (score: number, ply: number) => (score > MATE_BOUND ? score + ply : score < -MATE_BOUND ? score - ply : score);
const fromTT = (score: number, ply: number) => (score > MATE_BOUND ? score - ply : score < -MATE_BOUND ? score + ply : score);

/**
 * Searches `state` and scores the root moves. Always returns at least the
 * depth-1 result (depth 1 is never aborted), so a legal move is guaranteed
 * whenever one exists.
 */
export function search(v: VariantDefinition, state: GameState, params: SearchParams): SearchResult {
  const now = params.now ?? defaultNow;
  const start = now();
  const tt = new Map<string, TTEntry>();
  const values = v.pieceValues;
  const evalOpts = { mobility: params.mobility };
  let nodes = 0;
  let abortable = false;

  // Position keys seen in the game and along the current search path (repetition = draw).
  const seen = new Map<string, number>();
  for (const key of state.history) seen.set(key, (seen.get(key) ?? 0) + 1);
  const path: string[] = [];

  const tick = () => {
    if (++nodes % 512 !== 0 || !abortable) return;
    if (now() - start > params.timeLimitMs || params.shouldStop?.()) throw ABORT;
  };

  const orderScore = (m: Move, best: Move | undefined) => {
    if (sameMove(best, m)) return 1e7;
    if (m.captured !== undefined) return 1e6 + (values[m.captured] ?? 0) * 10 - (m.piece === 'k' ? 1000 : values[m.piece] ?? 0);
    if (m.promotion) return 9e5 + (values[m.promotion] ?? 0);
    return 0;
  };
  const ordered = (moves: Move[], best: Move | undefined) =>
    moves
      .map((m, i) => ({ m, s: orderScore(m, best), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.m);

  /** Draw by repetition (on the path or in the game), 50 moves or material, then the variant override. */
  const gameOver = (pos: Position, key: string, ply: number): GameResult | null => {
    const draw = pos.halfmove >= 100 || (ply > 0 && (seen.get(key) ?? 0) > 0) || isInsufficientMaterial(v, pos);
    const result: GameResult | null = draw ? { reason: 'threefold', winner: null } : null;
    if (!v.isGameOver) return result;
    const history = [...state.history, ...path, key];
    return v.isGameOver({ variantId: v.id, position: pos, history, moves: [], previous: null, result: null }, result);
  };

  const resultScore = (r: GameResult, pos: Position, ply: number) =>
    r.winner === null ? 0 : r.winner === pos.turn ? MATE - ply : -(MATE - ply);

  /** Static score at a horizon node; detects mate when the side to move is in check. */
  const leaf = (pos: Position, ply: number) => {
    if (isInCheck(v, pos) && legalMoves(v, pos).length === 0) return -(MATE - ply);
    return evaluate(v, pos, evalOpts);
  };

  /**
   * Mobility only matters when the score is near the alpha-beta bounds: skip the
   * expensive count when the static score is far outside it (lazy evaluation).
   */
  const lazyMobility = (pos: Position, alpha: number, beta: number) => {
    const s = evaluate(v, pos);
    return s + LAZY_MARGIN < alpha || s - LAZY_MARGIN > beta ? 0 : mobility(v, pos);
  };

  /**
   * Captures-only search. The mobility term (level 5) is computed once where the
   * quiescence search starts and carried down (`mob`, side to move's view):
   * captures barely change it and recomputing it per node is expensive.
   */
  const quiesce = (pos: Position, alpha: number, beta: number, ply: number, qply: number, mob: number): number => {
    tick();
    if (isInCheck(v, pos)) {
      // In check: every evasion is searched, no stand-pat.
      const evasions = legalMoves(v, pos);
      if (evasions.length === 0) return -(MATE - ply);
      if (qply >= MAX_QPLY) return evaluate(v, pos) + mob;
      let best = -INF;
      for (const m of ordered(evasions, undefined)) {
        const score = -quiesce(applyMove(v, pos, m), -beta, -alpha, ply + 1, qply + 1, -mob);
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return best;
    }
    const standPat = evaluate(v, pos) + mob;
    if (standPat >= beta || qply >= MAX_QPLY) return standPat;
    if (standPat > alpha) alpha = standPat;
    const captures = pseudoMoves(v, pos).filter((m) => (m.captured !== undefined || m.promotion) && isLegal(v, pos, m));
    let best = standPat;
    for (const m of ordered(captures, undefined)) {
      const score = -quiesce(applyMove(v, pos, m), -beta, -alpha, ply + 1, qply + 1, -mob);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  };

  const negamax = (pos: Position, depth: number, alpha: number, beta: number, ply: number): number => {
    tick();
    if (depth <= 0) {
      if (!params.quiescence) return leaf(pos, ply);
      return quiesce(pos, alpha, beta, ply, 0, params.mobility ? lazyMobility(pos, alpha, beta) : 0);
    }

    const legal = legalMoves(v, pos);
    if (legal.length === 0) return isInCheck(v, pos) ? -(MATE - ply) : 0;
    const key = positionKey(v, pos, legal);
    const over = gameOver(pos, key, ply);
    if (over) return resultScore(over, pos, ply);

    const alpha0 = alpha;
    const entry = params.transpositionTable ? tt.get(key) : undefined;
    if (entry && entry.depth >= depth) {
      const s = fromTT(entry.score, ply);
      if (entry.flag === 0) return s;
      if (entry.flag === 1 && s >= beta) return s;
      if (entry.flag === 2 && s <= alpha) return s;
    }

    let best = -INF;
    let bestMove: Move | undefined;
    path.push(key);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    try {
      for (const m of ordered(legal, entry?.move)) {
        const score = -negamax(applyMove(v, pos, m), depth - 1, -beta, -alpha, ply + 1);
        if (score > best) {
          best = score;
          bestMove = m;
        }
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
    } finally {
      path.pop();
      seen.set(key, seen.get(key)! - 1);
    }

    if (params.transpositionTable) {
      if (tt.size >= TT_LIMIT) tt.clear();
      const flag = best <= alpha0 ? 2 : best >= beta ? 1 : 0;
      tt.set(key, { depth, score: toTT(best, ply), flag, move: bestMove });
    }
    return best;
  };

  const root = state.position;
  const rootLegal = legalMoves(v, root);
  if (rootLegal.length === 0) throw new Error('search: no legal moves');
  const rootKey = positionKey(v, root, rootLegal);

  /** Scores every root move at `depth`. */
  const searchRoot = (depth: number, order: Move[]): ScoredMove[] => {
    const out: ScoredMove[] = [];
    const { topK, margin } = params.rootExact;
    const top: number[] = []; // best scores so far, descending, at most topK
    path.push(rootKey);
    try {
      for (const m of order) {
        const threshold = top.length < topK ? -INF : Math.min(top[topK - 1], top[0] - margin);
        const alpha = threshold === -INF ? -INF : threshold - 1;
        const score = -negamax(applyMove(v, root, m), depth - 1, -INF, -alpha, 1);
        out.push({ move: m, score });
        top.push(score);
        top.sort((a, b) => b - a);
        if (top.length > topK) top.length = topK;
      }
    } finally {
      path.pop();
    }
    return out
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
      .map((x) => x.s);
  };

  let scores: ScoredMove[] = [];
  let depth = 0;
  let order = ordered(rootLegal, undefined);
  for (let d = 1; d <= params.maxDepth; d++) {
    abortable = d > 1;
    try {
      scores = searchRoot(d, order);
    } catch (e) {
      if (e === ABORT) break;
      throw e;
    }
    depth = d;
    order = scores.map((s) => s.move);
    params.onInfo?.({ depth, score: scores[0].score, pv: [scores[0].move], nodes });
    if (Math.abs(scores[0].score) > MATE_BOUND) break; // forced mate found: deeper search can't improve it
    if (now() - start > params.timeLimitMs || params.shouldStop?.()) break;
    if (rootLegal.length === 1) break;
  }
  return { scores, depth, nodes };
}

export interface BotMove {
  readonly move: Move;
  /** Score of the chosen move, from the bot's point of view. */
  readonly score: number;
  readonly depth: number;
  readonly nodes: number;
}

export interface ChooseOptions {
  /** Seed for the level's randomness (ignored when `rng` is given). */
  readonly seed?: number;
  readonly rng?: Rng;
  /** Overrides the level's time limit (e.g. when the clock is low). */
  readonly timeLimitMs?: number;
  readonly shouldStop?: () => boolean;
  readonly now?: () => number;
  readonly onInfo?: (info: SearchInfo) => void;
}

/** Picks the bot's move for `level` (1–5). The move is always from the engine's legal move list. */
export function chooseMove(v: VariantDefinition, state: GameState, level: number, opts: ChooseOptions = {}): BotMove {
  const cfg = levelConfig(level);
  const rng = opts.rng ?? createRng(opts.seed ?? randomSeed());
  const result = search(v, state, {
    maxDepth: cfg.maxDepth,
    quiescence: cfg.quiescence,
    transpositionTable: cfg.transpositionTable,
    mobility: cfg.mobility,
    timeLimitMs: opts.timeLimitMs ?? cfg.timeLimitMs,
    rootExact: { topK: cfg.pick === 'top3-weighted' ? 3 : 1, margin: cfg.pick === 'near-best' ? cfg.margin : 0 },
    shouldStop: opts.shouldStop,
    now: opts.now,
    onInfo: opts.onInfo,
  });
  const { scores, depth, nodes } = result;
  const best = scores[0].score;
  let chosen: ScoredMove;
  switch (cfg.pick) {
    case 'random-half':
      chosen = rng.next() < 0.5 ? rng.pick(scores) : rng.pick(scores.filter((s) => s.score === best));
      break;
    case 'top3-weighted': {
      const top = scores.slice(0, 3);
      const weights = top.map((s) => Math.exp((s.score - best) / 100));
      let r = rng.next() * weights.reduce((a, b) => a + b, 0);
      chosen = top[top.length - 1];
      for (let i = 0; i < top.length; i++) {
        r -= weights[i];
        if (r < 0) {
          chosen = top[i];
          break;
        }
      }
      break;
    }
    case 'near-best': {
      // A found mate is never traded for a slower one.
      const floor = Math.abs(best) > MATE_BOUND ? best : best - cfg.margin;
      chosen = rng.pick(scores.filter((s) => s.score >= floor));
      break;
    }
    case 'best':
      chosen = rng.pick(scores.filter((s) => s.score === best));
      break;
  }
  return { move: chosen.move, score: chosen.score, depth, nodes };
}
