// Small API the UI uses to talk to the search worker.

import type { GameState } from '../engine/index.ts';
import { MIN_THINK_MS } from './levels.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { BotMove } from './search.ts';

export interface ThinkOptions {
  readonly variantId: string;
  readonly state: GameState;
  readonly level: number;
  readonly timeLimitMs?: number;
  readonly seed?: number;
  /** The answer is held back until at least this long after the request (default MIN_THINK_MS). */
  readonly minThinkMs?: number;
  readonly onInfo?: (info: { depth: number; score: number }) => void;
}

/** Rejection reason when a request is superseded or stopped. */
export class BotCancelled extends Error {
  constructor() {
    super('Bot araması iptal edildi');
  }
}

interface Pending {
  readonly id: number;
  readonly resolve: (m: BotMove) => void;
  readonly reject: (e: Error) => void;
  readonly onInfo?: ThinkOptions['onInfo'];
  readonly started: number;
  readonly minThinkMs: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** One search at a time; a new request or stop() cancels the running one. */
export class BotClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: Pending | null = null;

  think(opts: ThinkOptions): Promise<BotMove> {
    this.stop();
    const id = this.nextId++;
    const worker = this.ensureWorker();
    return new Promise<BotMove>((resolve, reject) => {
      this.pending = {
        id,
        resolve,
        reject,
        onInfo: opts.onInfo,
        started: Date.now(),
        minThinkMs: opts.minThinkMs ?? MIN_THINK_MS,
      };
      const msg: WorkerRequest = {
        t: 'think',
        id,
        variantId: opts.variantId,
        state: { position: opts.state.position, history: opts.state.history },
        level: opts.level,
        timeLimitMs: opts.timeLimitMs,
        seed: opts.seed,
      };
      worker.postMessage(msg);
    });
  }

  /** Cancels the running request. The worker is terminated: a busy search can't be interrupted otherwise. */
  stop(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.timer) clearTimeout(p.timer);
    this.worker?.postMessage({ t: 'stop', id: p.id } satisfies WorkerRequest);
    this.worker?.terminate();
    this.worker = null;
    p.reject(new BotCancelled());
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.worker = w;
    return w;
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending;
    if (!p || msg.id !== p.id) return; // stale answer
    if (msg.t === 'info') {
      p.onInfo?.({ depth: msg.depth, score: msg.score });
      return;
    }
    if (msg.t === 'error') {
      this.pending = null;
      p.reject(new Error(msg.message));
      return;
    }
    const result: BotMove = { move: msg.move, score: msg.score, depth: msg.depth, nodes: msg.nodes };
    const wait = p.minThinkMs - (Date.now() - p.started);
    if (wait <= 0) {
      this.pending = null;
      p.resolve(result);
    } else {
      p.timer = setTimeout(() => {
        if (this.pending !== p) return;
        this.pending = null;
        p.resolve(result);
      }, wait);
    }
  }
}
