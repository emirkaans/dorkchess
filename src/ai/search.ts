// Alpha-beta search on the fast board: PVS with iterative deepening and
// aspiration windows, transposition table, null-move pruning, late move
// reductions, killer/history ordering, check extension, futility pruning and a
// captures-only quiescence search. The board is compiled from the engine's
// variant definition, so every variant rule is respected without
// variant-specific code here. No React / DOM imports.

import { FastBoard, codeType, moveFrom, movePromo, moveTo } from '../engine/fast/board.ts';
import type { Side } from '../engine/fast/hooks.ts';
import { legalMoves } from '../engine/index.ts';
import type { GameState, Move, Position, VariantDefinition } from '../engine/index.ts';
import { MATE, MATE_BOUND, evaluateBoard } from './evaluate.ts';
import { levelConfig } from './levels.ts';
import { createRng, randomSeed } from './rng.ts';
import type { Rng } from './rng.ts';

const INF = 1_000_000;
const MAX_PLY = 100;
const MAX_MOVES = 256;
/** Transposition table entries (power of two), kept between searches of the same variant. */
export const TT_SIZE = 2 ** 20;

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
   * upper bound (they can't be picked anyway).
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

/** Monotonic clock in ms; `performance` exists in browsers, workers and Node, but isn't in the plain ES lib types. */
const defaultNow = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();

const ABORT = Symbol('abort');

/** A new iteration starts only before this share of the time limit (the limit itself aborts it). */
const SOFT_LIMIT = 0.6;

/** Ordering score band of captures whose SEE has not been computed yet (just under winning captures). */
const UNCHECKED = (1 << 26) - (1 << 24);

// ---------------------------------------------------------------------------
// Transposition table

const FLAG_EXACT = 1;
const FLAG_LOWER = 2;
const FLAG_UPPER = 3;

class TranspositionTable {
  readonly mask = TT_SIZE - 1;
  readonly keys = new Int32Array(TT_SIZE);
  readonly moves = new Int32Array(TT_SIZE);
  readonly scores = new Int32Array(TT_SIZE);
  readonly depths = new Int8Array(TT_SIZE);
  readonly flags = new Uint8Array(TT_SIZE);
  readonly gens = new Uint8Array(TT_SIZE);
  gen = 0;
}

let shared: { variant: string; tt: TranspositionTable } | null = null;
/** One table, reused while the same variant is searched (cleared on a variant change). */
function ttFor(v: VariantDefinition): TranspositionTable {
  if (!shared || shared.variant !== v.id) {
    const tt = shared?.tt ?? new TranspositionTable();
    tt.flags.fill(0);
    shared = { variant: v.id, tt };
  }
  shared.tt.gen = (shared.tt.gen + 1) & 255;
  return shared.tt;
}

/** Mate scores are stored relative to the node, not the root. */
const toTT = (s: number, ply: number) => (s > MATE_BOUND ? s + ply : s < -MATE_BOUND ? s - ply : s);
const fromTT = (s: number, ply: number) => (s > MATE_BOUND ? s - ply : s < -MATE_BOUND ? s + ply : s);

/** Late move reductions by depth and move number. */
const LMR = Array.from({ length: 64 }, (_, d) =>
  Array.from({ length: MAX_MOVES }, (_, m) => (d < 1 || m < 1 ? 0 : Math.floor(0.75 + (Math.log(d) * Math.log(m)) / 2.25))),
);

// ---------------------------------------------------------------------------

/** Positions since the last irreversible move, oldest first (for repetition detection). */
export function recentPositions(state: GameState): Position[] {
  const out: Position[] = [];
  let s = state.previous;
  let n = state.position.halfmove;
  while (s && n-- > 0) {
    out.push(s.position);
    s = s.previous;
  }
  return out.reverse();
}

interface RootScore {
  readonly move: number;
  readonly score: number;
}

class Searcher {
  readonly b: FastBoard;
  nodes = 0;
  private readonly tt: TranspositionTable | null;
  private abortable = false;
  private readonly start: number;
  private readonly now: () => number;
  private readonly values: Int32Array;
  private readonly killers = new Int32Array(MAX_PLY * 2);
  private readonly history = new Int32Array(2 * 64 * 64);
  /** Best reply found to the previous move (indexed by its from/to). */
  private readonly counter = new Int32Array(64 * 64);
  private readonly seeGain = new Int32Array(40);
  /** Static evaluation per ply (for the "improving" flag); -INF when unknown. */
  private readonly evalStack = new Int32Array(MAX_PLY + 2);
  private readonly seeAttackers = new Int8Array(32);
  private readonly seeSaveSq = new Int8Array(96);
  private readonly seeSaveCode = new Int8Array(96);
  /** Quiet moves tried at each ply (for the history penalty). */
  private readonly quietsTried = new Int32Array(MAX_PLY * 64);
  private readonly moveBuf = new Int32Array(MAX_PLY * MAX_MOVES);
  private readonly scoreBuf = new Int32Array(MAX_PLY * MAX_MOVES);
  /** Position keys of the game since the last irreversible move, then the search path. */
  private readonly keysLo: Int32Array;
  private readonly keysHi: Int32Array;
  private readonly base: number;
  private readonly evalOpts: { mobility: boolean };
  private readonly pawnType: number;

  private readonly params: SearchParams;

  constructor(v: VariantDefinition, root: Position, recent: readonly Position[], params: SearchParams) {
    this.params = params;
    this.now = params.now ?? defaultNow;
    this.start = this.now();
    this.b = new FastBoard(v);
    this.tt = params.transpositionTable ? ttFor(v) : null;
    this.values = new Int32Array(this.b.types.map((t) => (t.royal ? 1000 : (v.pieceValues[t.letter] ?? 0))));
    this.evalOpts = { mobility: params.mobility };
    this.pawnType = this.b.typeIndex.get('p') ?? -1;
    this.keysLo = new Int32Array(recent.length + MAX_PLY + 2);
    this.keysHi = new Int32Array(recent.length + MAX_PLY + 2);
    recent.forEach((p, i) => {
      this.b.load(p);
      this.keysLo[i] = this.b.keyLo();
      this.keysHi[i] = this.b.keyHi();
    });
    this.base = recent.length;
    this.b.load(root);
    this.pushKey(0);
  }

  private elapsed(): number {
    return this.now() - this.start;
  }

  private checkTime(): void {
    if (this.abortable && (this.elapsed() > this.params.timeLimitMs || this.params.shouldStop?.())) throw ABORT;
  }

  private evaluate(alpha = -INF, beta = INF): number {
    return evaluateBoard(this.b, this.evalOpts, alpha, beta);
  }

  private pushKey(ply: number): void {
    this.keysLo[this.base + ply] = this.b.keyLo();
    this.keysHi[this.base + ply] = this.b.keyHi();
  }

  /** Did the current position occur before since the last irreversible move (path or game)? */
  private repeated(ply: number): boolean {
    const idx = this.base + ply;
    const lo = this.keysLo[idx];
    const hi = this.keysHi[idx];
    const stop = Math.max(0, idx - this.b.halfmove);
    for (let i = idx - 2; i >= stop; i -= 2) if (this.keysLo[i] === lo && this.keysHi[i] === hi) return true;
    return false;
  }

  private hasPieces(side: Side): boolean {
    for (const t of this.b.types) {
      if (t.index === this.pawnType || t.royal || !this.values[t.index]) continue;
      if (this.b.count(t.index, side) > 0) return true;
    }
    return false;
  }

  /**
   * Static exchange evaluation of capture `m`: material balance after the
   * best sequence of recaptures on the target square, each side taking with
   * its least valuable piece and free to stop. Works on temporary square edits
   * (no make/unmake, so pins and changing Jester forms are ignored, as in a
   * classic SEE); the variant's capture rules still apply through attackersTo.
   */
  private see(m: number): number {
    const b = this.b;
    const sq = b.sq;
    const from = moveFrom(m);
    const to = moveTo(m);
    const victim = b.captured(m);
    if (victim === 0 || sq[to] === 0) return victim ? this.values[codeType(victim)] : 0; // en passant: plain gain
    const gain = this.seeGain;
    const saveSq = this.seeSaveSq;
    const saveCode = this.seeSaveCode;
    let saved = 0;
    const move = (f: number, code: number) => {
      saveSq[saved] = f;
      saveCode[saved++] = sq[f];
      saveSq[saved] = to;
      saveCode[saved++] = sq[to];
      sq[to] = code;
      sq[f] = 0;
    };
    gain[0] = this.values[codeType(victim)];
    const promo = movePromo(m);
    const mover = sq[from];
    const moverSide = mover > 0 ? 1 : -1;
    let piece = this.values[promo >= 0 ? promo : codeType(mover)];
    move(from, promo >= 0 ? moverSide * (promo + 1) : mover);
    let side: Side = b.side === 0 ? 1 : 0;
    let d = 0;
    const buf = this.seeAttackers;
    for (;;) {
      d++;
      gain[d] = piece - gain[d - 1];
      if (Math.max(-gain[d - 1], gain[d]) < 0 || d >= gain.length - 1) break;
      const n = b.attackersTo(to, side, buf);
      if (n === 0) break;
      let bi = 0;
      let bv = INF;
      for (let k = 0; k < n; k++) {
        const v = this.values[codeType(sq[buf[k]])];
        if (v < bv) [bv, bi] = [v, k];
      }
      const f = buf[bi];
      const code = sq[f];
      const t = b.types[codeType(code)];
      const lastRank = side === 0 ? 7 : 0;
      const p = t.isPawn && to >> 3 === lastRank && b.promoTypes.length ? b.promoTypes[0] : -1;
      move(f, p >= 0 ? (code > 0 ? 1 : -1) * (p + 1) : code);
      piece = this.values[p >= 0 ? p : t.index];
      side = side === 0 ? 1 : 0;
    }
    while (saved > 0) {
      saved--;
      sq[saveSq[saved]] = saveCode[saved];
    }
    while (--d) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
    return gain[0];
  }

  seeOf(m: number): number {
    return this.see(m);
  }

  /** Ordering scores for moves [start, end). */
  private scoreMoves(start: number, end: number, ttMove: number, ply: number): void {
    const b = this.b;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const prev = b.lastMove();
    const cm = prev > 0 ? this.counter[moveFrom(prev) * 64 + moveTo(prev)] : 0;
    const hist = b.side * 4096;
    for (let i = start; i < end; i++) {
      const m = this.moveBuf[i];
      let s: number;
      if (m === ttMove) s = 1 << 30;
      else {
        const victim = b.captured(m);
        const promo = movePromo(m);
        if (victim !== 0) {
          const vv = this.values[codeType(victim)];
          const av = this.values[codeType(b.sq[moveFrom(m)])];
          // Winning or even captures first. Captures by a more valuable piece are
          // checked with SEE only when picked (see pickChecked); losing ones go after the killers.
          s = (vv >= av ? 1 << 26 : UNCHECKED) + vv * 16 - av;
        } else if (promo >= 0) s = (1 << 25) + this.values[promo];
        else if (m === k1) s = 1 << 24;
        else if (m === k2) s = (1 << 24) - 1;
        else if (m === cm) s = (1 << 24) - 2;
        else s = this.history[hist + moveFrom(m) * 64 + moveTo(m)];
      }
      this.scoreBuf[i] = s;
    }
  }

  /**
   * Like pick, but a capture whose SEE is still unknown is checked first: a
   * losing one is demoted below the quiet killers and the next best is picked.
   */
  private pickChecked(i: number, end: number): number {
    for (;;) {
      const m = this.pick(i, end);
      const s = this.scoreBuf[i];
      if (s < UNCHECKED || s >= 1 << 26) return m;
      this.scoreBuf[i] = this.see(m) >= 0 ? s - UNCHECKED + (1 << 26) : s - UNCHECKED + (1 << 21);
      if (this.scoreBuf[i] >= 1 << 26) return m;
    }
  }

  /** Swaps the best-scored remaining move into slot i and returns it. */
  private pick(i: number, end: number): number {
    let best = i;
    for (let j = i + 1; j < end; j++) if (this.scoreBuf[j] > this.scoreBuf[best]) best = j;
    if (best !== i) {
      const m = this.moveBuf[i];
      this.moveBuf[i] = this.moveBuf[best];
      this.moveBuf[best] = m;
      const s = this.scoreBuf[i];
      this.scoreBuf[i] = this.scoreBuf[best];
      this.scoreBuf[best] = s;
    }
    return this.moveBuf[i];
  }

  private quiesce(alpha: number, beta: number, ply: number): number {
    if ((++this.nodes & 1023) === 0) this.checkTime();
    const b = this.b;
    if (ply >= MAX_PLY - 1) return this.evaluate();
    const inCheck = b.inCheck();
    let best = -INF;
    let standPat = -INF;
    if (!inCheck) {
      standPat = this.evaluate(alpha, beta);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      best = standPat;
    }
    const start = ply * MAX_MOVES;
    // In check every evasion is searched; otherwise captures and promotions only.
    const end = b.generate(this.moveBuf, start, !inCheck);
    this.scoreMoves(start, end, 0, ply);
    let legal = 0;
    for (let i = start; i < end; i++) {
      const m = this.pickChecked(i, end);
      if (!inCheck) {
        const victim = b.captured(m);
        const promo = movePromo(m);
        const gain = (victim ? this.values[codeType(victim)] : 0) + (promo >= 0 ? this.values[promo] : 0);
        // Delta pruning: even winning this piece can't lift the score to alpha.
        if (promo < 0 && standPat + gain + 200 < alpha) continue;
        // Losing capture by static exchange evaluation (already computed when picked).
        if (promo < 0 && this.scoreBuf[i] < 1 << 26) continue;
      }
      if (!b.make(m)) continue;
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      b.unmake();
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  /** Horizon without quiescence (low levels): static score, but mate is still recognised. */
  private leaf(ply: number, inCheck: boolean): number {
    if (inCheck) {
      const start = ply * MAX_MOVES;
      const end = this.b.generate(this.moveBuf, start);
      let any = false;
      for (let i = start; i < end && !any; i++) {
        if (this.b.make(this.moveBuf[i])) {
          any = true;
          this.b.unmake();
        }
      }
      if (!any) return -MATE + ply;
    }
    return this.evaluate();
  }

  /** `excluded`: a move left out of this search (singular extension test); such searches neither cut on nor store TT entries. */
  private negamax(
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    pv: boolean,
    allowNull: boolean,
    excluded = 0,
  ): number {
    if ((++this.nodes & 1023) === 0) this.checkTime();
    const b = this.b;
    if (ply > 0) {
      if (b.halfmove >= 100 || this.repeated(ply) || b.insufficientMaterial()) return 0;
      // Mate distance pruning
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    const inCheck = b.inCheck();
    if (inCheck) depth++; // check extension
    if (depth <= 0) return this.params.quiescence ? this.quiesce(alpha, beta, ply) : this.leaf(ply, inCheck);
    if (ply >= MAX_PLY - 1) return this.evaluate();

    const tt = this.tt;
    const lo = b.keyLo();
    const hi = b.keyHi();
    let ttMove = 0;
    if (tt) {
      const i = lo & tt.mask;
      if (tt.flags[i] && tt.keys[i] === hi) {
        ttMove = tt.moves[i];
        if (!pv && excluded === 0 && tt.depths[i] >= depth) {
          const s = fromTT(tt.scores[i], ply);
          const f = tt.flags[i];
          if (f === FLAG_EXACT || (f === FLAG_LOWER && s >= beta) || (f === FLAG_UPPER && s <= alpha)) return s;
        }
      }
    }
    // Internal iterative reduction: without a known best move, search a bit shallower.
    if (depth >= 4 && ttMove === 0) depth--;

    // Singular extension: if every other move falls clearly short of the table move's
    // score, the table move is the only good one and gets searched one ply deeper.
    let singular = 0;
    if (tt && excluded === 0 && ply > 0 && depth >= 8 && ttMove !== 0) {
      const i = lo & tt.mask;
      if (tt.flags[i] && tt.keys[i] === hi && tt.flags[i] !== FLAG_UPPER && tt.depths[i] >= depth - 3) {
        const ttScore = fromTT(tt.scores[i], ply);
        if (Math.abs(ttScore) < MATE_BOUND) {
          const sBeta = ttScore - 2 * depth;
          const s = this.negamax((depth - 1) >> 1, sBeta - 1, sBeta, ply, false, false, ttMove);
          if (s < sBeta) singular = 1;
          else if (sBeta >= beta) return sBeta; // multi-cut: several moves beat beta anyway
        }
      }
    }

    // Only used for pruning decisions, so the lazy bounds are the node's own.
    const staticEval = inCheck || pv ? -INF : this.evaluate(alpha, beta);
    this.evalStack[ply] = staticEval;
    // Improving: better than two plies ago (our previous turn), so prune less.
    const improving = ply >= 2 && staticEval > -INF && staticEval > this.evalStack[ply - 2] ? 1 : 0;
    if (!pv && !inCheck && Math.abs(beta) < MATE_BOUND) {
      // Reverse futility: far above beta even with a safety margin.
      if (depth <= 6 && staticEval - 80 * (depth - improving) >= beta) return staticEval;
      // Razoring: hopeless near the leaves unless a capture sequence saves it.
      if (depth <= 2 && staticEval + 250 * depth <= alpha) {
        const q = this.params.quiescence ? this.quiesce(alpha, beta, ply) : staticEval;
        if (q <= alpha) return q;
      }
      // Null move: if passing still fails high, the position is good enough.
      if (allowNull && depth >= 3 && staticEval >= beta && this.hasPieces(b.side)) {
        const r = 3 + (depth >> 2);
        b.makeNull();
        this.pushKey(ply + 1);
        const s = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false, false);
        b.unmakeNull();
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    const start = ply * MAX_MOVES;
    const end = b.generate(this.moveBuf, start);
    this.scoreMoves(start, end, ttMove, ply);
    const alpha0 = alpha;
    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    let quiets = 0;
    const side = b.side;
    for (let i = start; i < end; i++) {
      const m = this.pickChecked(i, end);
      if (m === excluded) continue;
      const quiet = b.captured(m) === 0 && movePromo(m) < 0;
      if (!pv && !inCheck && quiet && legal > 0 && best > -MATE_BOUND) {
        // Late move pruning and futility pruning of quiet moves near the leaves.
        if (depth <= 3 && legal >= (3 + 2 * depth * depth) / (2 - improving)) continue;
        if (depth <= 2 && staticEval + 100 + 100 * depth <= alpha) continue;
      }
      // SEE pruning: captures that lose material clearly, near the leaves.
      if (!pv && !inCheck && !quiet && depth <= 4 && legal > 0 && best > -MATE_BOUND && this.scoreBuf[i] < 1 << 25) {
        if (this.see(m) < -100 * depth) continue;
      }
      if (!b.make(m)) continue;
      legal++;
      if (quiet && quiets < 64) this.quietsTried[ply * 64 + quiets++] = m;
      this.pushKey(ply + 1);
      let score: number;
      if (legal === 1) {
        score = -this.negamax(depth - 1 + (m === ttMove ? singular : 0), -beta, -alpha, ply + 1, pv, true);
      } else {
        let r = 0;
        if (depth >= 3 && quiet && !inCheck && legal > (pv ? 3 : 2) && !b.inCheck()) {
          r = LMR[Math.min(depth, 63)][Math.min(legal, MAX_MOVES - 1)];
          if (pv) r--;
          if (m === this.killers[ply * 2] || m === this.killers[ply * 2 + 1]) r--;
          r = Math.max(0, Math.min(r, depth - 2));
        }
        score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, false, true);
        if (score > alpha && r > 0) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, false, true);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true, true);
      }
      b.unmake();
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (quiet) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              const prev = b.lastMove();
              if (prev > 0) this.counter[moveFrom(prev) * 64 + moveTo(prev)] = m;
              // History with gravity: reward the cut move, penalise the quiet moves tried before it.
              const bonus = Math.min(depth * depth, 400);
              for (let q = 0; q < quiets; q++) {
                const qm = this.quietsTried[ply * 64 + q];
                const h = side * 4096 + moveFrom(qm) * 64 + moveTo(qm);
                const delta = qm === m ? bonus : -bonus;
                this.history[h] += delta - Math.trunc((this.history[h] * Math.abs(delta)) / 16384);
              }
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return excluded !== 0 ? alpha : inCheck ? -MATE + ply : 0;

    if (tt && excluded === 0) {
      const i = lo & tt.mask;
      if (!tt.flags[i] || tt.keys[i] === hi || tt.gens[i] !== tt.gen || depth >= tt.depths[i] - 2) {
        tt.keys[i] = hi;
        tt.moves[i] = bestMove;
        tt.scores[i] = toTT(best, ply);
        tt.depths[i] = Math.min(depth, 127);
        tt.flags[i] = best <= alpha0 ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
        tt.gens[i] = tt.gen;
      }
    }
    return best;
  }

  /**
   * Scores the root moves at `depth`, best first. The first move is searched
   * in an aspiration window around `guess`; later moves only get exact scores
   * if they can still be picked (see SearchParams.rootExact).
   */
  private searchRoot(depth: number, order: readonly number[], guess: number | null): RootScore[] {
    const b = this.b;
    const { topK, margin } = this.params.rootExact;
    const out: RootScore[] = [];
    const top: number[] = [];
    for (let k = 0; k < order.length; k++) {
      const m = order[k];
      b.make(m);
      this.pushKey(1);
      let score: number;
      if (k === 0) {
        let lo = guess === null ? -INF : guess - 30;
        let hi = guess === null ? INF : guess + 30;
        for (;;) {
          score = -this.negamax(depth - 1, -hi, -lo, 1, true, true);
          if (score <= lo && lo > -INF) lo = Math.max(-INF, lo - 4 * (hi - lo));
          else if (score >= hi && hi < INF) hi = Math.min(INF, hi + 4 * (hi - lo));
          else break;
        }
      } else {
        const threshold = top.length < topK ? -INF : Math.min(top[topK - 1], top[0] - margin);
        if (threshold === -INF) score = -this.negamax(depth - 1, -INF, INF, 1, true, true);
        else {
          const alpha = threshold - 1;
          score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, false, true);
          if (score > alpha) score = -this.negamax(depth - 1, -INF, -alpha, 1, true, true);
        }
      }
      b.unmake();
      out.push({ move: m, score });
      top.push(score);
      top.sort((a, c) => c - a);
      if (top.length > topK) top.length = topK;
    }
    return out
      .map((s, i) => ({ s, i }))
      .sort((a, c) => c.s.score - a.s.score || a.i - c.i)
      .map((x) => x.s);
  }

  run(): { scores: RootScore[]; depth: number } {
    const rootMoves = this.b.legalMoves();
    if (rootMoves.length === 0) throw new Error('search: no legal moves');
    this.moveBuf.set(rootMoves, 0);
    this.scoreMoves(0, rootMoves.length, 0, 0);
    let order = rootMoves
      .map((m, i) => ({ m, s: this.scoreBuf[i], i }))
      .sort((a, c) => c.s - a.s || a.i - c.i)
      .map((x) => x.m);
    let scores: RootScore[] = [];
    let depth = 0;
    for (let d = 1; d <= this.params.maxDepth; d++) {
      this.abortable = d > 1;
      try {
        scores = this.searchRoot(d, order, d >= 5 ? scores[0].score : null);
      } catch (e) {
        if (e === ABORT) break;
        throw e;
      }
      depth = d;
      order = scores.map((s) => s.move);
      this.params.onInfo?.({ depth, score: scores[0].score, pv: [], nodes: this.nodes });
      if (Math.abs(scores[0].score) > MATE_BOUND || rootMoves.length === 1) break;
      // Soft limit: an iteration started late would most likely be aborted unfinished.
      if (this.elapsed() > this.params.timeLimitMs * SOFT_LIMIT || this.params.shouldStop?.()) break;
    }
    return { scores, depth };
  }
}

/** SEE of a legal engine move in `pos`, in centipawns (exposed for tests). */
export function staticExchange(v: VariantDefinition, pos: Position, move: Move): number {
  const s = new Searcher(v, pos, [], {
    maxDepth: 1,
    quiescence: false,
    transpositionTable: false,
    mobility: false,
    timeLimitMs: 1000,
    rootExact: { topK: 1, margin: 0 },
  });
  const promo = move.promotion ? s.b.typeIndex.get(move.promotion)! : -1;
  const m = s.b.legalMoves().find((x) => moveFrom(x) === move.from && moveTo(x) === move.to && movePromo(x) === promo)!;
  return s.seeOf(m);
}

/**
 * Searches `state` and scores the root moves. Always returns at least the
 * depth-1 result (depth 1 is never aborted), so a legal move is guaranteed
 * whenever one exists.
 */
export function search(v: VariantDefinition, state: GameState, params: SearchParams): SearchResult {
  const s = new Searcher(v, state.position, recentPositions(state), params);
  const { scores, depth } = s.run();
  const legal = legalMoves(v, state.position);
  const toMove = (m: number): Move => {
    const promo = movePromo(m);
    const promotion = promo >= 0 ? s.b.types[promo].letter : undefined;
    const found = legal.find((x) => x.from === moveFrom(m) && x.to === moveTo(m) && x.promotion === promotion);
    if (!found) throw new Error(`search: fast move ${moveFrom(m)}-${moveTo(m)} is not legal in the engine`);
    return found;
  };
  return { scores: scores.map((x) => ({ move: toMove(x.move), score: x.score })), depth, nodes: s.nodes };
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
  const { scores, depth, nodes } = search(v, state, {
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
  const best = scores[0].score;
  let chosen: ScoredMove;
  switch (cfg.pick) {
    case 'random-half':
      chosen = rng.next() < 0.5 ? rng.pick(scores) : rng.pick(scores.filter((s) => s.score === best));
      break;
    case 'top3-weighted': {
      const top = scores.slice(0, 3);
      const weights = top.map((s) => Math.exp((s.score - best) / 100));
      let r = rng.next() * weights.reduce((a, c) => a + c, 0);
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
