import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { classifyMoves, formatScore, graphValue, terminalScore, toWhite, whiteShare } from '../ai/analysis.ts';
import type { WhiteScore } from '../ai/analysis.ts';
import { BotClient, BotCancelled } from '../ai/client.ts';
import { HINT } from '../ai/levels.ts';
import { moveToSan } from '../engine/index.ts';
import type { GameState, Move, VariantDefinition } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { MoveList } from './MoveList.tsx';
import { SharePanel } from './ShareTools.tsx';
import type { PgnMeta } from './ShareTools.tsx';
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
  /** Heading of the side panel (game name, players, …). */
  title?: ReactNode;
  /** Extra buttons (export, back, …) shown at the bottom of the side panel. */
  children?: ReactNode;
  /** Start analysing as soon as the viewer opens. */
  autoAnalyse?: boolean;
  /** Names and result for the exported PGN. */
  meta?: PgnMeta;
  /** Opens the game on the analysis board at the given position. */
  onOpenAnalysis?: (states: readonly GameState[], cursor: number) => void;
}

/** SAN of the engine's suggestion (empty if it cannot be written). */
function bestSan(variant: VariantDefinition, state: GameState, move: Move | null): string {
  if (!move) return '';
  try {
    return moveToSan(variant, state.position, move);
  } catch {
    return '';
  }
}

/** Keys that step through the moves. */
const KEY_STEPS: Record<string, (cursor: number, last: number) => number> = {
  ArrowLeft: (c) => c - 1,
  ArrowRight: (c) => c + 1,
  ArrowUp: () => 0,
  Home: () => 0,
  ArrowDown: (_, last) => last,
  End: (_, last) => last,
};

/**
 * Read-only game viewer laid out like an analysis board: the board fills the
 * height with an evaluation bar (black on top, white below) on its right; the
 * side panel holds the engine line, the moves, the graph and the navigation.
 * Arrow keys step through the moves.
 */
export function GameViewer({ variant, states, title, children, autoAnalyse = false, meta, onOpenAnalysis }: Props) {
  const { t } = useI18n();
  const [cursor, setCursor] = useState(states.length - 1);
  const [flipped, setFlipped] = useState(false);
  const { analysis, start, stop } = useAnalysis(variant, states);
  const state = states[cursor];
  const last = states.length - 1;
  const turns = useMemo(() => states.map((s) => s.position.turn), [states]);
  const marks = useMemo(() => classifyMoves(analysis.evals, turns), [analysis.evals, turns]);
  const analysed = analysis.evals.filter((e) => e !== null).length;
  const score = analysis.evals[cursor];
  const best = analysis.best[cursor];
  const showEval = analysed > 0 || analysis.running;
  const go = (c: number) => setCursor(Math.max(0, Math.min(last, c)));

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    if (autoAnalyse) void startRef.current();
  }, [autoAnalyse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const step = KEY_STEPS[e.key];
      if (!step) return;
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(last, step(c, last))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  // Keep the shown move visible in the move list.
  const movesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = movesRef.current;
    if (!box) return;
    const current = box.querySelector<HTMLElement>('.mv.current');
    if (!current) {
      box.scrollTop = 0;
      return;
    }
    const top = current.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + current.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 2;
    }
  }, [cursor]);

  const san = bestSan(variant, state, best);

  return (
    <div className="viewer">
      <div className="viewer-board">
        <div className="diagram">
          <Board
            variant={variant}
            position={state.position}
            lastMove={state.moves.at(-1)?.move ?? null}
            flipped={flipped}
            highlight={variant.highlight ? variant.highlight.squares(state.position) : []}
            bandRanks={variant.highlight?.ranks ?? []}
            arrows={best ? [[best.from, best.to]] : []}
            disabled
            onMove={() => {}}
          />
        </div>
        {showEval && <EvalBar score={score} flipped={flipped} />}
      </div>

      <div className="viewer-side">
        {title && <div className="viewer-title">{title}</div>}

        <div className="viewer-engine">
          {showEval && (
            <div className="viewer-eval">
              <span className="viewer-score">{score === null ? '…' : formatScore(score)}</span>
              <span className="viewer-best">
                {score === null ? t('analysis.notYet') : san ? t('analysis.best', { san }) : ''}
              </span>
            </div>
          )}
          {analysis.running ? (
            <button className="viewer-progress" onClick={stop}>
              <span className="viewer-progress-fill" style={{ width: `${(analysed / states.length) * 100}%` }} />
              <span className="viewer-progress-text">
                {t('analysis.progress', { done: analysed, total: states.length })}
              </span>
            </button>
          ) : (
            analysed < states.length && (
              <button className="primary" onClick={() => void start()}>
                {analysed ? t('analysis.continue') : t('analysis.start')}
              </button>
            )
          )}
        </div>

        <div className="viewer-moves" ref={movesRef}>
          <MoveList game={states[last]} cursor={cursor} onSelect={setCursor} marks={marks} />
        </div>

        {analysed > 0 && <EvalGraph evals={analysis.evals} cursor={cursor} onSelect={setCursor} />}

        <div className="viewer-nav">
          <button onClick={() => go(0)} disabled={cursor === 0} aria-label={t('nav.first')} title={t('nav.first')}>
            <NavIcon d="M6 5v14M18 5l-8 7 8 7" />
          </button>
          <button
            onClick={() => go(cursor - 1)}
            disabled={cursor === 0}
            aria-label={t('nav.back')}
            title={t('nav.back')}
          >
            <NavIcon d="M15 5l-7 7 7 7" />
          </button>
          <span className="replay-pos">
            {cursor}/{last}
          </span>
          <button
            onClick={() => go(cursor + 1)}
            disabled={cursor === last}
            aria-label={t('nav.forward')}
            title={t('nav.forward')}
          >
            <NavIcon d="M9 5l7 7-7 7" />
          </button>
          <button onClick={() => go(last)} disabled={cursor === last} aria-label={t('nav.last')} title={t('nav.last')}>
            <NavIcon d="M18 5v14M6 5l8 7-8 7" />
          </button>
          <button
            onClick={() => setFlipped((f) => !f)}
            aria-label={t('controls.flip')}
            title={t('controls.flip')}
            aria-pressed={flipped}
          >
            <NavIcon d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
          </button>
        </div>

        {showEval && <p className="muted analysis-note">{t('analysis.marks')}</p>}
        <SharePanel
          variant={variant}
          states={states}
          cursor={cursor}
          meta={meta}
          onOpenAnalysis={onOpenAnalysis && (() => onOpenAnalysis(states, cursor))}
        />
        {children && <div className="viewer-actions">{children}</div>}
      </div>
    </div>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Vertical bar beside the board: White's share from White's side (bottom unless flipped), Black's above. */
export function EvalBar({ score, flipped }: { score: WhiteScore | null; flipped: boolean }) {
  const { t } = useI18n();
  const share = score === null ? 0.5 : whiteShare(score);
  const whiteAhead = share >= 0.5;
  const text = score === null ? '…' : formatScore(score);
  // The score is written at the end of the side that is ahead.
  const textAtBottom = whiteAhead !== flipped;
  return (
    <div
      className={`eval-bar${flipped ? ' flipped' : ''}`}
      role="img"
      title={text}
      aria-label={`${t('analysis.bar')}: ${text}`}
    >
      <div className="eval-white" style={{ height: `${share * 100}%` }} />
      <div className="eval-mid" />
      <span className={`eval-text ${textAtBottom ? 'bottom' : 'top'} ${whiteAhead ? 'on-white' : 'on-black'}`}>
        {text}
      </span>
    </div>
  );
}

/** Evaluation over the game (white area = White better); click to jump to a position. */
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
  const xy = evals.flatMap((s, i) => (s === null ? [] : [[(i / n) * 400, y(s)] as const]));
  const points = xy.map(([px, py]) => `${px},${py}`);
  const area = xy.length > 1 ? `${xy[0][0]},200 ${points.join(' ')} ${xy[xy.length - 1][0]},200` : '';
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
      {area && <polygon points={area} className="eval-area" />}
      <line x1="0" y1="100" x2="400" y2="100" className="eval-axis" />
      {points.length > 1 && <polyline points={points.join(' ')} className="eval-line" />}
      <line x1={(cursor / n) * 400} y1="0" x2={(cursor / n) * 400} y2="200" className="eval-cursor" />
    </svg>
  );
}
