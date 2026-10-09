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
    // Rebuild the chain of previous positions the search reads for repetitions.
    const node = (position: GameState['position'], previous: GameState | null): GameState => ({
      variantId: msg.variantId,
      position,
      history: [],
      moves: [],
      previous,
      result: null,
    });
    const previous = msg.state.recent.reduce<GameState | null>((prev, pos) => node(pos, prev), null);
    const state: GameState = { ...node(msg.state.position, previous), history: msg.state.history };
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
