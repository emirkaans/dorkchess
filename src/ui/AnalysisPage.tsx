import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { formatScore, terminalScore, toWhite } from '../ai/analysis.ts';
import type { WhiteScore } from '../ai/analysis.ts';
import { BotCancelled, BotClient } from '../ai/client.ts';
import { HINT } from '../ai/levels.ts';
import {
  createGame,
  emptyBoard,
  getVariant,
  isInCheck,
  listVariants,
  makeMove,
  makeSquare,
  moveToSan,
  opposite,
  parseFen,
  rankOf,
  royalSquares,
  squareName,
  toFen,
} from '../engine/index.ts';
import type { Color, GameState, Move, Piece, PieceType, Position, Square, VariantDefinition } from '../engine/index.ts';
import { errorText } from '../i18n/index.ts';
import { Board } from './Board.tsx';
import { EvalBar } from './GameViewer.tsx';
import { MoveList } from './MoveList.tsx';
import { PieceView } from './PieceView.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { ImportDialog, SharePanel } from './ShareTools.tsx';
import type { ImportedLine } from './ShareTools.tsx';
import { useI18n } from './i18n.tsx';

/** Engine time per position on the analysis board. */
export const LIVE_ANALYSIS_MS = 3000;

type Tool = { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; piece: Piece };

/** Corner squares that carry castling rights: king square and rook square per right. */
const CASTLE_SQUARES = { wK: [4, 7], wQ: [4, 0], bK: [60, 63], bQ: [60, 56] } as const;
type CastleRight = keyof typeof CASTLE_SQUARES;

const samePiece = (a: Piece | null, b: Piece | null) => !!a && !!b && a.type === b.type && a.color === b.color;

/** Keeps a castling right only while the king and rook still stand where the variant starts them. */
function sanitize(v: VariantDefinition, pos: Position): Position {
  const start = parseFen(v, v.startPosition).board;
  const ok = (right: CastleRight) =>
    pos.castling[right] && CASTLE_SQUARES[right].every((sq) => start[sq] && samePiece(pos.board[sq], start[sq]));
  return {
    ...pos,
    castling: { wK: ok('wK'), wQ: ok('wQ'), bK: ok('bK'), bQ: ok('bQ') },
    ep: null,
    halfmove: 0,
    fullmove: 1,
  };
}

type Problem = 'king' | 'check' | 'pawn';

/** Why a position cannot be analysed (null: fine). */
function problemOf(v: VariantDefinition, pos: Position): Problem | null {
  const hasRoyal = Object.values(v.pieces).some((d) => d.royal);
  if (hasRoyal && (['w', 'b'] as const).some((c) => royalSquares(v, pos, c).length === 0)) return 'king';
  const pawnOnEdge = pos.board.some((p, sq) => {
    if (!p) return false;
    const r = rankOf(sq);
    return (r === 0 || r === 7) && v.pieces[p.type].patterns(pos, p.color).some((m) => m.kind === 'pawn');
  });
  if (pawnOnEdge) return 'pawn';
  if (hasRoyal && isInCheck(v, pos, opposite(pos.turn))) return 'check';
  return null;
}

interface Live {
  readonly score: WhiteScore | null;
  readonly best: Move | null;
  readonly depth: number;
  readonly thinking: boolean;
}

/** Engine on the shown position: restarts whenever it changes; stops when switched off. */
function useLiveAnalysis(variant: VariantDefinition, state: GameState | null, on: boolean): Live {
  const [client] = useState(() => new BotClient());
  const [live, setLive] = useState<Live>({ score: null, best: null, depth: 0, thinking: false });
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    if (!state || !on) {
      client.stop();
      setLive({ score: null, best: null, depth: 0, thinking: false });
      return;
    }
    const terminal = terminalScore(state);
    if (terminal !== null) {
      setLive({ score: terminal, best: null, depth: 0, thinking: false });
      return;
    }
    let current = true;
    const turn = state.position.turn;
    setLive({ score: null, best: null, depth: 0, thinking: true });
    client
      .think({
        variantId: variant.id,
        state,
        level: HINT.level,
        timeLimitMs: LIVE_ANALYSIS_MS,
        minThinkMs: 0,
        onInfo: ({ depth, score }) => {
          if (current) setLive((l) => ({ ...l, depth, score: toWhite(score, turn) }));
        },
      })
      .then((r) => {
        if (current) setLive({ score: toWhite(r.score, turn), best: r.move, depth: r.depth, thinking: false });
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

/**
 * Analysis board with a board editor: set up any position (pieces, side to
 * move, castling, FEN), then play moves for both sides while the engine
 * shows the evaluation bar, the score and its best move.
 */
/** A game handed to the analysis board, opened at `cursor`. */
export interface AnalysisSeed {
  /** Changes with every hand-over (the page starts afresh). */
  readonly key: number;
  readonly variantId: string;
  readonly states: readonly GameState[];
  readonly cursor: number;
}

export function AnalysisPage({
  initialVariantId,
  seed = null,
}: {
  initialVariantId: string;
  seed?: AnalysisSeed | null;
}) {
  const { t, vt } = useI18n();
  const [variantId, setVariantId] = useState(seed?.variantId ?? initialVariantId);
  const variant = getVariant(variantId);
  const texts = vt(variant);

  const [mode, setMode] = useState<'edit' | 'analyse'>(seed ? 'analyse' : 'edit');
  const [editPos, setEditPos] = useState<Position>(() =>
    seed ? seed.states[seed.cursor].position : parseFen(variant, variant.startPosition),
  );
  const [tool, setTool] = useState<Tool>({ kind: 'move' });
  const [pickFrom, setPickFrom] = useState<Square | null>(null);
  const [fenDraft, setFenDraft] = useState<string | null>(null);
  const [fenError, setFenError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  const [states, setStates] = useState<GameState[]>(() => (seed ? [...seed.states] : []));
  const [cursor, setCursor] = useState(seed?.cursor ?? 0);
  const [importing, setImporting] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [engineOn, setEngineOn] = useState(true);
  const [copied, setCopied] = useState(false);

  const analysing = mode === 'analyse' && states.length > 0;
  const state = analysing ? states[cursor] : null;
  const last = states.length - 1;
  const live = useLiveAnalysis(variant, state, engineOn);

  const pieceTypes = useMemo(() => Object.keys(variant.pieces) as PieceType[], [variant]);
  // The FEN shown (and analysed) drops castling rights the pieces no longer allow.
  const cleanPos = sanitize(variant, editPos);
  const editFen = toFen(variant, cleanPos);
  const problem = problemOf(variant, cleanPos);

  // ---------- editor ----------

  const setBoard = (change: (board: (Piece | null)[]) => void) =>
    setEditPos((p) => {
      const board = [...p.board];
      change(board);
      return { ...p, board };
    });

  const clickSquare = (sq: Square) => {
    if (tool.kind === 'erase') return setBoard((b) => void (b[sq] = null));
    if (tool.kind === 'piece') {
      return setBoard((b) => void (b[sq] = samePiece(b[sq], tool.piece) ? null : tool.piece));
    }
    if (pickFrom === null) {
      if (editPos.board[sq]) setPickFrom(sq);
      return;
    }
    if (pickFrom !== sq) {
      const from = pickFrom;
      setBoard((b) => {
        b[sq] = b[from];
        b[from] = null;
      });
    }
    setPickFrom(null);
  };
  const removeAt = (e: ReactMouseEvent, sq: Square) => {
    e.preventDefault();
    setBoard((b) => void (b[sq] = null));
  };

  const loadPosition = (pos: Position) => {
    setEditPos(pos);
    setPickFrom(null);
    setFenDraft(null);
    setFenError(null);
  };
  const changeVariant = (id: string) => {
    const v = getVariant(id);
    setVariantId(id);
    setMode('edit');
    setStates([]);
    setEditPos(parseFen(v, v.startPosition));
    setPickFrom(null);
    setFenDraft(null);
    setFenError(null);
  };
  const applyFen = () => {
    if (fenDraft === null) return;
    try {
      loadPosition(parseFen(variant, fenDraft));
    } catch (e) {
      setFenError(t('analysisPage.fenError', { reason: errorText(e, t) }));
    }
  };

  const startAnalysis = () => {
    if (problem) return;
    const game = createGame(variant, editFen);
    setStates([game]);
    setCursor(0);
    setMode('analyse');
    setPromotion(null);
  };
  /** A pasted PGN, FEN or link: a game opens in analysis mode at its last move. */
  const importLine = (line: ImportedLine) => {
    setVariantId(line.variantId);
    setStates([...line.states]);
    setCursor(line.states.length - 1);
    setEditPos(line.states[line.states.length - 1].position);
    setMode('analyse');
    setPromotion(null);
    setPickFrom(null);
    setImporting(false);
  };

  const backToEditor = () => {
    if (state) loadPosition(state.position);
    setMode('edit');
    setPromotion(null);
  };

  // ---------- analysis ----------

  const play = (move: Move) => {
    if (!state) return;
    const nextState = states[cursor + 1];
    const played = nextState?.moves.at(-1)?.move;
    // The same move as the one already in the line: just step forward.
    if (played && played.from === move.from && played.to === move.to && played.promotion === move.promotion) {
      setCursor(cursor + 1);
      return;
    }
    const next = makeMove(variant, state, move);
    setStates([...states.slice(0, cursor + 1), next]);
    setCursor(cursor + 1);
  };
  const onMove = (candidates: Move[]) => (candidates.length > 1 ? setPromotion(candidates) : play(candidates[0]));
  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };

  // Arrow keys step through the line while analysing.
  useEffect(() => {
    if (!analysing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.closest('.board')) return; // the board uses arrow keys itself
      const steps: Record<string, (c: number) => number> = {
        ArrowLeft: (c) => c - 1,
        ArrowRight: (c) => c + 1,
        Home: () => 0,
        End: () => last,
      };
      const step = steps[e.key];
      if (!step) return;
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(last, step(c))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analysing, last]);

  const copyFen = async (fen: string) => {
    try {
      await navigator.clipboard.writeText(fen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('copyPrompt'), fen);
    }
  };

  const shownPos = state ? state.position : editPos;
  const bestSan = (() => {
    if (!state || !live.best) return '';
    try {
      return moveToSan(variant, state.position, live.best);
    } catch {
      return '';
    }
  })();
  const status = (() => {
    if (!state) return '';
    const r = state.result;
    if (!r) return t('status.turn', { color: t(`color.${state.position.turn}`) });
    const end = t(`termination.${r.reason}`);
    return r.winner ? `${end} — ${t('outcome.winner', { color: t(`color.${r.winner}`) })}` : end;
  })();

  // Squares of the editor overlay, top-left first as the board is drawn.
  const overlay = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8);
    const col = i % 8;
    return flipped ? makeSquare(7 - col, row) : makeSquare(col, 7 - row);
  });
  const toolButton = (key: string, active: boolean, label: string, onClick: () => void, content: ReactNode) => (
    <button
      key={key}
      className={`palette-tool${active ? ' on' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {content}
    </button>
  );

  return (
    <main className="analysis-page">
      <div className="analysis-board">
        <div className="analysis-board-inner">
          <Board
            variant={variant}
            position={shownPos}
            lastMove={state?.moves.at(-1)?.move ?? null}
            flipped={flipped}
            highlight={variant.highlight ? variant.highlight.squares(shownPos) : []}
            bandRanks={variant.highlight?.ranks ?? []}
            arrows={live.best && engineOn ? [[live.best.from, live.best.to]] : []}
            disabled={!state || !!state.result || promotion !== null}
            onMove={onMove}
          />
          {mode === 'edit' && (
            <div className="editor-grid">
              {overlay.map((sq) => {
                const piece = editPos.board[sq];
                const name = piece
                  ? t('square.piece', { color: t(`colorLower.${piece.color}`), piece: texts.pieceName(piece.type) })
                  : t('square.empty');
                return (
                  <button
                    key={sq}
                    className={`editor-square${pickFrom === sq ? ' picked' : ''}`}
                    aria-label={`${squareName(sq)}: ${name}`}
                    onClick={() => clickSquare(sq)}
                    onContextMenu={(e) => removeAt(e, sq)}
                  />
                );
              })}
            </div>
          )}
          {promotion && state && (
            <PromotionDialog
              variant={variant}
              color={state.position.turn}
              options={promotion.map((m) => m.promotion!)}
              onPick={onPromote}
              onCancel={() => setPromotion(null)}
            />
          )}
        </div>
        {analysing && engineOn && <EvalBar score={live.score} flipped={flipped} />}
      </div>

      <aside className="analysis-side">
        <div className="analysis-head">
          <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <h1>{mode === 'edit' ? t('analysisPage.editor') : t('analysisPage.title')}</h1>
          <button className="analysis-import" onClick={() => setImporting(true)}>
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4M12 3v12M7 10l5 5 5-5" />
            </svg>
            {t('import.button')}
          </button>
        </div>

        {mode === 'edit' ? (
          <>
            <label className="analysis-field">
              <span>{t('analysisPage.variant')}</span>
              <select value={variantId} onChange={(e) => changeVariant(e.target.value)}>
                {listVariants().map((v) => (
                  <option key={v.id} value={v.id}>
                    {vt(v).name}
                  </option>
                ))}
              </select>
            </label>

            <div className="palette" role="group" aria-label={t('analysisPage.pieces')}>
              {toolButton(
                'move',
                tool.kind === 'move',
                t('analysisPage.toolMove'),
                () => setTool({ kind: 'move' }),
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
                </svg>,
              )}
              {toolButton(
                'erase',
                tool.kind === 'erase',
                t('analysisPage.toolErase'),
                () => {
                  setTool({ kind: 'erase' });
                  setPickFrom(null);
                },
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 20H9L4 15a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" />
                  <path d="M8 9l7 7" />
                </svg>,
              )}
              {(['w', 'b'] as Color[]).flatMap((color) =>
                pieceTypes.map((type) => {
                  const active = tool.kind === 'piece' && samePiece(tool.piece, { type, color });
                  return toolButton(
                    `${color}${type}`,
                    active,
                    `${t(`color.${color}`)} ${texts.pieceName(type)}`,
                    () => {
                      setTool({ kind: 'piece', piece: { type, color } });
                      setPickFrom(null);
                    },
                    <PieceView variant={variant} piece={{ type, color }} />,
                  );
                }),
              )}
            </div>
            <p className="muted analysis-hint">{t('analysisPage.hint')}</p>

            <fieldset className="analysis-row">
              <legend>{t('analysisPage.toMove')}</legend>
              {(['w', 'b'] as Color[]).map((c) => (
                <label key={c} className={`chip${editPos.turn === c ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="analysis-turn"
                    checked={editPos.turn === c}
                    onChange={() => setEditPos((p) => ({ ...p, turn: c }))}
                  />
                  {t(`color.${c}`)}
                </label>
              ))}
            </fieldset>

            <fieldset className="analysis-row">
              <legend>{t('analysisPage.castling')}</legend>
              {(['wK', 'wQ', 'bK', 'bQ'] as CastleRight[]).map((right) => (
                <label key={right} className={`chip${editPos.castling[right] ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={editPos.castling[right]}
                    onChange={() =>
                      setEditPos((p) => ({ ...p, castling: { ...p.castling, [right]: !p.castling[right] } }))
                    }
                  />
                  {t(`color.${right[0] as Color}`)} {right[1] === 'K' ? 'O-O' : 'O-O-O'}
                </label>
              ))}
            </fieldset>

            <div className="analysis-buttons">
              <button onClick={() => loadPosition(parseFen(variant, variant.startPosition))}>
                {t('analysisPage.start')}
              </button>
              <button
                onClick={() =>
                  loadPosition({
                    ...editPos,
                    board: emptyBoard(),
                    castling: { wK: false, wQ: false, bK: false, bQ: false },
                  })
                }
              >
                {t('analysisPage.clear')}
              </button>
              <button onClick={() => setFlipped((f) => !f)}>{t('controls.flip')}</button>
            </div>

            <label className="analysis-field">
              <span>FEN</span>
              <span className="fen-row">
                <input
                  value={fenDraft ?? editFen}
                  spellCheck={false}
                  onChange={(e) => {
                    setFenDraft(e.target.value);
                    setFenError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && applyFen()}
                  onBlur={applyFen}
                />
                <button onClick={() => copyFen(editFen)}>
                  {copied ? t('controls.copied') : t('analysisPage.copy')}
                </button>
              </span>
            </label>
            {fenError && <p className="error">{fenError}</p>}
            {problem && <p className="analysis-problem">{t(`analysisPage.invalid.${problem}`)}</p>}

            <button className="primary analysis-go" onClick={startAnalysis} disabled={!!problem}>
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path className="fill" d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
              {t('analysisPage.analyse')}
            </button>
          </>
        ) : (
          <>
            <div className="viewer-engine">
              <label className="switch-row">
                <input type="checkbox" checked={engineOn} onChange={() => setEngineOn((o) => !o)} />
                <span className="switch" aria-hidden="true" />
                {t('analysisPage.engine')}
                {engineOn && live.depth > 0 && (
                  <span className="muted analysis-depth">{t('analysisPage.depth', { depth: live.depth })}</span>
                )}
              </label>
              {engineOn && (
                <div className="viewer-eval">
                  <span className="viewer-score">{live.score === null ? '…' : formatScore(live.score)}</span>
                  <span className="viewer-best">
                    {bestSan ? t('analysis.best', { san: bestSan }) : live.thinking ? t('analysisPage.thinking') : ''}
                  </span>
                </div>
              )}
            </div>
            <div className={`status${state?.result ? ' alert' : ''}`}>{status}</div>

            <div className="viewer-moves">
              <MoveList game={states[last]} cursor={cursor} onSelect={setCursor} />
            </div>

            <div className="viewer-nav">
              <button
                onClick={() => setCursor(0)}
                disabled={cursor === 0}
                aria-label={t('nav.first')}
                title={t('nav.first')}
              >
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 5v14M18 5l-8 7 8 7" />
                </svg>
              </button>
              <button
                onClick={() => setCursor((c) => Math.max(0, c - 1))}
                disabled={cursor === 0}
                aria-label={t('nav.back')}
                title={t('nav.back')}
              >
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <span className="replay-pos">
                {cursor}/{last}
              </span>
              <button
                onClick={() => setCursor((c) => Math.min(last, c + 1))}
                disabled={cursor === last}
                aria-label={t('nav.forward')}
                title={t('nav.forward')}
              >
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                onClick={() => setCursor(last)}
                disabled={cursor === last}
                aria-label={t('nav.last')}
                title={t('nav.last')}
              >
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 5v14M6 5l8 7-8 7" />
                </svg>
              </button>
              <button
                onClick={() => setFlipped((f) => !f)}
                aria-label={t('controls.flip')}
                title={t('controls.flip')}
                aria-pressed={flipped}
              >
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                </svg>
              </button>
            </div>

            {state && (
              <label className="analysis-field">
                <span>FEN</span>
                <span className="fen-row">
                  <input readOnly value={toFen(variant, state.position)} spellCheck={false} />
                  <button onClick={() => copyFen(toFen(variant, state.position))}>
                    {copied ? t('controls.copied') : t('analysisPage.copy')}
                  </button>
                </span>
              </label>
            )}
            <SharePanel variant={variant} states={states} cursor={cursor} />

            <button className="analysis-go" onClick={backToEditor}>
              {t('analysisPage.edit')}
            </button>
          </>
        )}
      </aside>
      {importing && <ImportDialog variantId={variantId} onImport={importLine} onClose={() => setImporting(false)} />}
    </main>
  );
}
