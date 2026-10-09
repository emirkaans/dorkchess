// Message contract between the UI (client.ts) and the search worker (worker.ts).

import type { Move, Position } from '../engine/index.ts';

/** What the search needs from a game: the position, its history keys and the positions since the last irreversible move. */
export interface SerializedState {
  readonly position: Position;
  readonly history: readonly string[];
  /** Oldest first (see recentPositions in search.ts); used for repetition detection. */
  readonly recent: readonly Position[];
}

export type WorkerRequest =
  | {
      readonly t: 'think';
      readonly id: number;
      readonly variantId: string;
      readonly state: SerializedState;
      readonly level: number;
      readonly timeLimitMs?: number;
      readonly seed?: number;
    }
  | { readonly t: 'stop'; readonly id: number };

export type WorkerResponse =
  | {
      readonly t: 'bestmove';
      readonly id: number;
      readonly move: Move;
      readonly score: number;
      readonly depth: number;
      readonly nodes: number;
    }
  | {
      readonly t: 'info';
      readonly id: number;
      readonly depth: number;
      readonly score: number;
      readonly pv: readonly Move[];
    }
  | { readonly t: 'error'; readonly id: number; readonly message: string };
