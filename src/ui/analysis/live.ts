// Engine on one position (analysis board and the variations of the game viewer).

import { useEffect, useState } from 'react';
import { terminalScore, toWhite } from '../../ai/analysis.ts';
import type { WhiteScore } from '../../ai/analysis.ts';
import { BotCancelled } from '../../ai/client.ts';
import { AnalysisClient } from '../../ai/stockfish.ts';
import { HINT } from '../../ai/levels.ts';
import type { GameState, Move, VariantDefinition } from '../../engine/index.ts';
import type { LineMove } from '../../ai/search.ts';

/**
 * Engine time per position on the analysis board: Stockfish (standard chess)
 * goes deep in a few seconds; our engine (variants) gets longer, its line
 * deepening on screen meanwhile.
 */
export const LIVE_ANALYSIS_MS = 4000;
export const LIVE_ANALYSIS_OWN_MS = 12000;

export interface Live {
  readonly score: WhiteScore | null;
  readonly best: Move | null;
  /** The engine's best line from this position. */
  readonly line: readonly LineMove[];
  readonly depth: number;
  readonly thinking: boolean;
}

/** Engine on the shown position: restarts whenever it changes; stops when switched off. */
export function useLiveAnalysis(variant: VariantDefinition, state: GameState | null, on: boolean): Live {
  const [client] = useState(() => new AnalysisClient());
  const [live, setLive] = useState<Live>({ score: null, best: null, line: [], depth: 0, thinking: false });
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    if (!state || !on) {
      client.stop();
      setLive({ score: null, best: null, line: [], depth: 0, thinking: false });
      return;
    }
    const terminal = terminalScore(state);
    if (terminal !== null) {
      setLive({ score: terminal, best: null, line: [], depth: 0, thinking: false });
      return;
    }
    let current = true;
    const turn = state.position.turn;
    setLive({ score: null, best: null, line: [], depth: 0, thinking: true });
    client
      .think({
        variantId: variant.id,
        state,
        level: HINT.level,
        timeLimitMs: client.usesStockfish(variant.id) ? LIVE_ANALYSIS_MS : LIVE_ANALYSIS_OWN_MS,
        minThinkMs: 0,
        analyse: true,
        onInfo: ({ depth, score, pv }) => {
          if (current) setLive((l) => ({ ...l, depth, score: toWhite(score, turn), line: pv }));
        },
      })
      .then((r) => {
        if (current)
          setLive({
            score: toWhite(r.score, turn),
            best: r.move,
            line: r.pv ?? [r.move],
            depth: r.depth,
            thinking: false,
          });
      })
      .catch((e) => {
        if (!(e instanceof BotCancelled) && current) setLive((l) => ({ ...l, thinking: false }));
      });
    return () => {
      current = false;
      client.stop();
    };
  }, [client, variant, state, on]);
  return live;
}
