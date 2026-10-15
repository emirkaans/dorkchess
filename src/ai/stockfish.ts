// Analysis engine: Stockfish for standard chess, our own engine for the
// variants (Stockfish does not know their rules).
//
// Stockfish is the unmodified Stockfish.js 18 "lite single-threaded" build
// (GPLv3, https://github.com/nmrugg/stockfish.js, based on
// https://github.com/official-stockfish/Stockfish), served from
// public/stockfish/ and run as its own worker; the app only talks to it in UCI
// text. If it cannot start (an old browser), our engine is used instead.

import { findMove, getVariant, listVariants, parseSquare, toFen } from '../engine/index.ts';
import type { GameState, Move, PieceType } from '../engine/index.ts';
import { BotCancelled, BotClient } from './client.ts';
import type { ThinkOptions } from './client.ts';
import { MATE } from './evaluate.ts';
import type { BotMove, LineMove } from './search.ts';

export const STOCKFISH_URL = '/stockfish/stockfish-18-lite-single.js';

/** A UCI move ("e7e8q") as squares and promotion. */
export function uciToLine(uci: string): LineMove {
  const promotion = uci.length > 4 ? uci[4] : undefined;
  return promotion
    ? { from: parseSquare(uci.slice(0, 2)), to: parseSquare(uci.slice(2, 4)), promotion }
    : { from: parseSquare(uci.slice(0, 2)), to: parseSquare(uci.slice(2, 4)) };
}

/** A UCI score for the side to move, in our engine's form (centipawns; mates as MATE minus plies). */
export function uciScore(kind: string, value: number): number {
  if (kind === 'cp') return value;
  // "mate 3": the side to move mates in 3 moves (5 plies); "mate -2": it is mated in 2 (4 plies).
  return value > 0 ? MATE - (2 * value - 1) : -(MATE - 2 * -value);
}

export interface UciInfo {
  readonly depth: number;
  readonly score: number;
  readonly nodes: number;
  readonly pv: readonly string[];
}

/** An "info" line with a score and a line (bounds and other lines are skipped), or null. */
export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || line.includes(' lowerbound') || line.includes(' upperbound')) return null;
  const words = line.split(' ');
  const at = (key: string) => words.indexOf(key);
  const multipv = at('multipv');
  if (multipv >= 0 && words[multipv + 1] !== '1') return null;
  const s = at('score');
  const pv = at('pv');
  const d = at('depth');
  if (s < 0 || pv < 0 || d < 0) return null;
  const n = at('nodes');
  return {
    depth: Number(words[d + 1]),
    score: uciScore(words[s + 1], Number(words[s + 2])),
    nodes: n >= 0 ? Number(words[n + 1]) : 0,
    pv: words.slice(pv + 1).filter(Boolean),
  };
}

/** "position fen <start> moves …": the game from its first position, so repetitions count. */
export function uciPosition(state: GameState): string {
  const v = getVariant(state.variantId);
  let root = state;
  while (root.previous) root = root.previous;
  const uci = (m: Move) =>
    `${'abcdefgh'[m.from % 8]}${Math.floor(m.from / 8) + 1}${'abcdefgh'[m.to % 8]}${Math.floor(m.to / 8) + 1}${m.promotion ?? ''}`;
  const moves = state.moves.slice(root.moves.length).map((p) => uci(p.move));
  return `position fen ${toFen(v, root.position)}${moves.length ? ` moves ${moves.join(' ')}` : ''}`;
}

interface Pending {
  readonly state: GameState;
  readonly resolve: (m: BotMove) => void;
  readonly reject: (e: Error) => void;
  readonly onInfo?: ThinkOptions['onInfo'];
  last: UciInfo | null;
}

/** One Stockfish worker, one search at a time; a new request or stop() cancels the running one. */
class StockfishClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending | null = null;
  // "bestmove" answers still to come from searches that were stopped.
  private stale = 0;
  failed = false;

  think(opts: ThinkOptions): Promise<BotMove> {
    this.stop();
    return new Promise<BotMove>((resolve, reject) => {
      const p: Pending = { state: opts.state, resolve, reject, onInfo: opts.onInfo, last: null };
      this.pending = p;
      this.start()
        .then(() => {
          if (this.pending !== p) return;
          this.send(uciPosition(opts.state));
          this.send(`go movetime ${Math.max(50, opts.timeLimitMs ?? 1000)}`);
        })
        .catch((e: Error) => {
          if (this.pending === p) this.pending = null;
          reject(e);
        });
    });
  }

  stop(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (this.worker && this.ready) {
      this.stale++;
      this.send('stop');
    }
    p.reject(new BotCancelled());
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.stale = 0;
  }

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let w: Worker;
      try {
        w = new Worker(STOCKFISH_URL);
      } catch (e) {
        this.failed = true;
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
      this.worker = w;
      w.onerror = () => {
        this.failed = true;
        this.pending?.reject(new Error('stockfish failed'));
        this.pending = null;
        reject(new Error('stockfish failed'));
      };
      w.onmessage = (e: MessageEvent<string>) => {
        const line = String(e.data);
        if (line === 'uciok') this.send('isready');
        else if (line === 'readyok') resolve();
        else this.onLine(line);
      };
      this.send('uci');
    });
    return this.ready;
  }

  private onLine(line: string): void {
    if (line.startsWith('bestmove')) {
      if (this.stale > 0) {
        this.stale--;
        return;
      }
      const p = this.pending;
      if (!p) return;
      this.pending = null;
      const uci = line.split(' ')[1];
      const v = getVariant(p.state.variantId);
      const best = uci && uci !== '(none)' ? uciToLine(uci) : null;
      const move = best ? findMove(v, p.state, best.from, best.to, best.promotion as PieceType | undefined) : null;
      if (!move) return p.reject(new Error(`stockfish: no move (${line})`));
      const info = p.last;
      p.resolve({
        move,
        score: info?.score ?? 0,
        depth: info?.depth ?? 0,
        nodes: info?.nodes ?? 0,
        pv: info?.pv.length ? info.pv.map(uciToLine) : [best!],
      });
      return;
    }
    const p = this.pending;
    if (!p || this.stale > 0) return;
    const info = parseInfo(line);
    if (!info) return;
    p.last = info;
    p.onInfo?.({ depth: info.depth, score: info.score, pv: info.pv.map(uciToLine) });
  }
}

/**
 * The engine for analysis: Stockfish for standard chess, our own engine for
 * the variants (and wherever Stockfish cannot run). Same calls as BotClient.
 */
export class AnalysisClient {
  private own = new BotClient();
  private sf = new StockfishClient();

  /** Whether this variant is analysed by Stockfish. */
  usesStockfish(variantId: string): boolean {
    return variantId === listVariants()[0].id && !this.sf.failed && typeof Worker !== 'undefined';
  }

  think(opts: ThinkOptions): Promise<BotMove> {
    if (!this.usesStockfish(opts.variantId)) return this.own.think(opts);
    this.own.stop();
    return this.sf.think(opts).catch((e: Error) => {
      if (e instanceof BotCancelled || !this.sf.failed) throw e;
      // Stockfish could not start: our engine answers instead.
      return this.own.think(opts);
    });
  }

  stop(): void {
    this.own.stop();
    this.sf.stop();
  }

  dispose(): void {
    this.own.dispose();
    this.sf.dispose();
  }
}
