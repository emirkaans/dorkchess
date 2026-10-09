import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { classifyMoves, formatScore, graphValue, terminalScore, toWhite, whiteShare } from '../ai/analysis.ts';
import type { WhiteScore } from '../ai/analysis.ts';
import { BotClient, BotCancelled } from '../ai/client.ts';
import { HINT } from '../ai/levels.ts';
import type { GameState, Move, VariantDefinition } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { MoveList } from './MoveList.tsx';
import { useI18n } from './i18n.tsx';

/** Search time per position during analysis. */
export const ANALYSIS_MS = 300;

interface Analysis {
  /** Score per position (White's view); null = not analysed yet. */
  readonly evals: readonly (WhiteScore | null)[];
  /** Engine's best move per position (to show where the game went wrong). */
  readonly best: readonly (Move | null)[];
  readonly running: boolean;
}

/**
 * Analyses every position of a game in the worker, one after another
 * (ANALYSIS_MS each). Stops when the component unmounts or `stop` is called.
 */
function useAnalysis(variant: VariantDefinition, states: readonly GameState[]) {
  const empty = (): Analysis => ({ evals: states.map(() => null), best: states.map(() => null), running: false });
  const [analysis, setAnalysis] = useState<Analysis>(empty);
  const [client] = useState(() => new BotClient());
  const run = useRef(0);
  useEffect(() => () => client.dispose(), [client]);

  const start = async () => {
    const token = ++run.current;
    setAnalysis((a) => ({ ...a, running: true }));
    for (let i = 0; i < states.length && run.current === token; i++) {
      const state = states[i];
      const terminal = terminalScore(state);
      let score: WhiteScore | null = terminal;
      let best: Move | null = null;
      if (terminal === null) {
        try {
          const r = await client.think({
            variantId: variant.id,
            state,
            level: HINT.level,
            timeLimitMs: ANALYSIS_MS,
            minThinkMs: 0,
          });
          score = toWhite(r.score, state.position.turn);
          best = r.move;
        } catch (e) {
          if (e instanceof BotCancelled) return;
          throw e;
        }
      }
      if (run.current !== token) return;
      setAnalysis((a) => ({
        ...a,
        evals: a.evals.map((x, k) => (k === i ? score : x)),
        best: a.best.map((x, k) => (k === i ? best : x)),
      }));
    }
    if (run.current === token) setAnalysis((a) => ({ ...a, running: false }));
  };

  const stop = () => {
    run.current++;
    client.stop();
    setAnalysis((a) => ({ ...a, running: false }));
  };

  return { analysis, start, stop };
}

interface Props {
  variant: VariantDefinition;
  states: readonly GameState[];
  /** Extra buttons (export, back, …) shown after the navigation controls. */
  children?: ReactNode;
  /** Start analysing as soon as the viewer opens. */
  autoAnalyse?: boolean;
}

/** Read-only game viewer: board, move list, slider; optional analysis (eval bar, graph, best move, marks). */
export function GameViewer({ variant, states, children, autoAnalyse = false }: Props) {
  const { t } = useI18n();
  const [cursor, setCursor] = useState(states.length - 1);
  const { analysis, start, stop } = useAnalysis(variant, states);
  const state = states[cursor];
  const last = states.length - 1;
  const turns = useMemo(() => states.map((s) => s.position.turn), [states]);
  const marks = useMemo(() => classifyMoves(analysis.evals, turns), [analysis.evals, turns]);
  const analysed = analysis.evals.filter((e) => e !== null).length;
  const score = analysis.evals[cursor];
  const best = analysis.best[cursor];

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    if (autoAnalyse) void startRef.current();
  }, [autoAnalyse]);

  return (
    <div className="viewer">
      <div className="replay-body">
        <div className="viewer-board" style={{ '--board': 'min(76vw, 360px)' } as CSSProperties}>
          {analysed > 0 && <EvalBar score={score} />}
          <div className="diagram">
            <Board
              variant={variant}
              position={state.position}
              lastMove={state.moves.at(-1)?.move ?? null}
              flipped={false}
              highlight={variant.highlight ? variant.highlight.squares(state.position) : []}
              bandRanks={variant.highlight?.ranks ?? []}
              arrows={best ? [[best.from, best.to]] : []}
              disabled
              onMove={() => {}}
            />
          </div>
        </div>
        <div className="replay-side">
          <MoveList game={states[last]} cursor={cursor} onSelect={setCursor} marks={marks} />
        </div>
      </div>
      {analysed > 0 && <EvalGraph evals={analysis.evals} cursor={cursor} onSelect={setCursor} />}
      <input
        type="range"
        className="replay-slider"
        min={0}
        max={last}
        value={cursor}
        onChange={(e) => setCursor(Number(e.target.value))}
        aria-label={t('nav.slider')}
      />
      <div className="controls">
        <button onClick={() => setCursor(0)} disabled={cursor === 0} aria-label={t('nav.first')}>
          ⏮
        </button>
        <button onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0} aria-label={t('nav.back')}>
          ◀
        </button>
        <span className="muted replay-pos">
          {cursor}/{last}
        </span>
        <button
          onClick={() => setCursor((c) => Math.min(last, c + 1))}
          disabled={cursor === last}
          aria-label={t('nav.forward')}
        >
          ▶
        </button>
        <button onClick={() => setCursor(last)} disabled={cursor === last} aria-label={t('nav.last')}>
          ⏭
        </button>
        {analysis.running ? (
          <button onClick={stop}>{t('analysis.progress', { done: analysed, total: states.length })}</button>
        ) : (
          analysed < states.length && (
            <button className="primary" onClick={() => void start()}>
              {analysed ? t('analysis.continue') : t('analysis.start')}
            </button>
          )
        )}
        {children}
      </div>
      {analysed > 0 && (
        <p className="muted analysis-note">
          {score !== null ? t('analysis.score', { score: formatScore(score) }) : t('analysis.notYet')}
          {best ? t('analysis.arrow') : ''} {t('analysis.marks')}
        </p>
      )}
    </div>
  );
}

/** Vertical bar: White's share from the bottom, the score as text. */
function EvalBar({ score }: { score: WhiteScore | null }) {
  const { t } = useI18n();
  const share = score === null ? 0.5 : whiteShare(score);
  return (
    <div className="eval-bar" title={score === null ? '' : formatScore(score)} aria-label={t('analysis.bar')}>
      <div className="eval-white" style={{ height: `${share * 100}%` }} />
      <span className={share >= 0.5 ? 'eval-text bottom' : 'eval-text top'}>
        {score === null ? '…' : formatScore(score)}
      </span>
    </div>
  );
}

/** Evaluation over the game; click to jump to a position. */
function EvalGraph({
  evals,
  cursor,
  onSelect,
}: {
  evals: readonly (WhiteScore | null)[];
  cursor: number;
  onSelect: (i: number) => void;
}) {
  const { t } = useI18n();
  const n = Math.max(1, evals.length - 1);
  const y = (s: number) => 100 - graphValue(s) / 8; // ±800 -> 0..200
  const points = evals.flatMap((s, i) => (s === null ? [] : [`${(i / n) * 400},${y(s)}`]));
  return (
    <svg
      className="eval-graph"
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      role="img"
      aria-label={t('analysis.graph')}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (r.width > 0) onSelect(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <line x1="0" y1="100" x2="400" y2="100" className="eval-axis" />
      {points.length > 1 && <polyline points={points.join(' ')} className="eval-line" />}
      <line x1={(cursor / n) * 400} y1="0" x2={(cursor / n) * 400} y2="200" className="eval-cursor" />
    </svg>
  );
}
