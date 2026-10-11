import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { classifyMoves, formatScore, graphValue, terminalScore, toWhite, whiteShare } from '../ai/analysis.ts';
import type { WhiteScore } from '../ai/analysis.ts';
import { BotClient, BotCancelled } from '../ai/client.ts';
import { HINT } from '../ai/levels.ts';
import { moveToSan } from '../engine/index.ts';
import type { GameState, Move, PieceType, VariantDefinition } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { MoveTreeView } from './analysis/MoveTreeView.tsx';
import { TreeNav, useTreeKeys } from './analysis/TreeNav.tsx';
import { useLiveAnalysis } from './analysis/live.ts';
import { addMove, pathTo, statesTo, treeOf } from './analysis/tree.ts';
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
            analyse: true,
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
  /** The game's id, for its links (/<id>, /<id>/analysis). */
  gameId?: string;
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

/**
 * Game viewer laid out like an analysis board: the board fills the height with
 * an evaluation bar (black on top, white below) on its right; the side panel
 * holds the engine line, the moves, the graph and the navigation. Moves can be
 * tried on the board: they open variations next to the game (as on lichess),
 * which the engine looks at live. Arrow keys walk the moves.
 */
export function GameViewer({
  variant,
  states,
  title,
  children,
  autoAnalyse = false,
  meta,
  onOpenAnalysis,
  gameId,
}: Props) {
  const { t } = useI18n();
  const [tree, setTree] = useState(() => treeOf(states));
  const [current, setCurrent] = useState(states.length - 1);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const { analysis, start, stop } = useAnalysis(variant, states);
  const state = tree.nodes[current].state;
  // Nodes 0..states.length-1 are the game itself (see treeOf); later ids are tried moves.
  const inGame = current < states.length;
  const turns = useMemo(() => states.map((s) => s.position.turn), [states]);
  const marks = useMemo(() => {
    const m = new Map<number, string>();
    classifyMoves(analysis.evals, turns).forEach((mark, i) => {
      if (mark) m.set(i + 1, mark);
    });
    return m;
  }, [analysis.evals, turns]);
  const analysed = analysis.evals.filter((e) => e !== null).length;
  const live = useLiveAnalysis(variant, inGame ? null : state, true);
  const score = inGame ? analysis.evals[current] : live.score;
  const best = inGame ? analysis.best[current] : live.best;
  const showEval = analysed > 0 || analysis.running || !inGame;
  // The game position the shown one comes from (for the graph's cursor).
  const gameIndex = useMemo(() => {
    let i = 0;
    for (const id of pathTo(tree, current)) if (id < states.length) i = id;
    return i;
  }, [tree, current, states.length]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    if (autoAnalyse) void startRef.current();
  }, [autoAnalyse]);

  useTreeKeys(tree, setCurrent);

  // Keep the shown move visible in the move list.
  const movesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = movesRef.current;
    if (!box) return;
    const shown = box.querySelector<HTMLElement>('.mv.current');
    if (!shown) {
      box.scrollTop = 0;
      return;
    }
    const top = shown.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + shown.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 2;
    }
  }, [current]);

  const play = (move: Move) => {
    const r = addMove(tree, variant, current, move);
    setTree(r.tree);
    setCurrent(r.id);
  };
  const onMove = (candidates: Move[]) => (candidates.length > 1 ? setPromotion(candidates) : play(candidates[0]));
  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };

  const san = bestSan(variant, state, best ?? null);
  const shownLine = statesTo(tree, current);

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
            disabled={!!state.result || promotion !== null}
            onMove={onMove}
          />
          {promotion && (
            <PromotionDialog
              variant={variant}
              color={state.position.turn}
              options={promotion.map((m) => m.promotion!)}
              onPick={onPromote}
              onCancel={() => setPromotion(null)}
            />
          )}
        </div>
        {showEval && <EvalBar score={score ?? null} flipped={flipped} />}
      </div>

      <div className="viewer-side">
        {title && <div className="viewer-title">{title}</div>}

        <div className="viewer-engine">
          {showEval && (
            <div className="viewer-eval">
              <span className="viewer-score">{score == null ? '…' : formatScore(score)}</span>
              <span className="viewer-best">
                {score == null ? t('analysis.notYet') : san ? t('analysis.best', { san }) : ''}
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
          <MoveTreeView tree={tree} current={current} onSelect={setCurrent} marks={marks} />
        </div>

        {analysed > 0 && <EvalGraph evals={analysis.evals} cursor={gameIndex} onSelect={setCurrent} />}

        <TreeNav
          tree={tree}
          current={current}
          onSelect={setCurrent}
          onTree={(next, id) => {
            setTree(next);
            setCurrent(id);
          }}
          flipped={flipped}
          onFlip={() => setFlipped((f) => !f)}
        />

        {showEval && <p className="muted analysis-note">{t('analysis.marks')}</p>}
        <SharePanel
          variant={variant}
          states={shownLine}
          cursor={shownLine.length - 1}
          gameId={gameId}
          meta={meta}
          onOpenAnalysis={onOpenAnalysis && (() => onOpenAnalysis(shownLine, shownLine.length - 1))}
        />
        {children && <div className="viewer-actions">{children}</div>}
      </div>
    </div>
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
