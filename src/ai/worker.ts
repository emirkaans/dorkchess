// Web Worker entry point: runs the search off the UI thread.
// A running search can't read new messages, so "stop" is handled by the client
// terminating this worker; answers carry the request id so stale ones are ignored.

import { getVariant } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import { chooseMove } from './search.ts';

const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
};

ctx.onmessage = ({ data: msg }) => {
  if (msg.t !== 'think') return;
  const { id } = msg;
  try {
    const v = getVariant(msg.variantId);
    const state: GameState = {
      variantId: msg.variantId,
      position: msg.state.position,
      history: msg.state.history,
      moves: [],
      previous: null,
      result: null,
    };
    const r = chooseMove(v, state, msg.level, {
      seed: msg.seed,
      timeLimitMs: msg.timeLimitMs,
      onInfo: (info) => ctx.postMessage({ t: 'info', id, depth: info.depth, score: info.score, pv: info.pv }),
    });
    ctx.postMessage({ t: 'bestmove', id, move: r.move, score: r.score, depth: r.depth, nodes: r.nodes });
  } catch (e) {
    ctx.postMessage({ t: 'error', id, message: e instanceof Error ? e.message : String(e) });
  }
};
