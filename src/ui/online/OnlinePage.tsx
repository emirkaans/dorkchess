import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { TIME_CONTROLS, timeControl } from '../../clock/clock.ts';
import type { ClockState } from '../../clock/clock.ts';
import { createGame, findMove, getVariant, isInCheck, listVariants, makeMove, opposite } from '../../engine/index.ts';
import type { Color, GameState, Move, PieceType, VariantDefinition } from '../../engine/index.ts';
import type { GameView, OnlineOutcome } from '../../online/protocol.ts';
import { Board } from '../Board.tsx';
import { BoardResizer } from '../BoardResizer.tsx';
import { GameViewer } from '../GameViewer.tsx';
import { Modal } from '../Modal.tsx';
import { MoveList } from '../MoveList.tsx';
import { PlayerRow } from '../PlayerRow.tsx';
import { PromotionDialog } from '../PromotionDialog.tsx';
import { Splatter } from '../Punk.tsx';
import { SetupDialog } from '../SetupDialog.tsx';
import { outcomeText } from '../game/session.ts';
import type { Outcome } from '../game/session.ts';
import { useI18n } from '../i18n.tsx';
import type { Prefs } from '../prefs.ts';
import { playSound } from '../sound.ts';
import {
  ApiError,
  createOnlineGame,
  joinOnlineGame,
  loadName,
  loadTicket,
  saveName,
  useOnlineGame,
} from './connection.ts';

const HUMAN = { kind: 'human' } as const;

interface Props {
  /** Game shown, or null for the lobby (create a game). */
  gameId: string | null;
  onOpenGame: (gameId: string) => void;
  onLobby: () => void;
  prefs: Prefs;
  setPrefs: Dispatch<SetStateAction<Prefs>>;
  defaultVariantId: string;
}

export function OnlinePage({ gameId, ...rest }: Props) {
  return gameId ? <OnlineGame key={gameId} gameId={gameId} {...rest} /> : <Lobby {...rest} />;
}

// ---------------------------------------------------------------------------
// Lobby: create a game and get a link to send.

function Lobby({ onOpenGame, defaultVariantId }: Omit<Props, 'gameId'>) {
  const { t, vt } = useI18n();
  const [name, setName] = useState(loadName);
  const [variantId, setVariantId] = useState(defaultVariantId);
  const [timeControlId, setTimeControlId] = useState('5+0');
  const [color, setColor] = useState<Color | 'random'>('random');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    saveName(name.trim());
    try {
      const ticket = await createOnlineGame({ variantId, timeControlId, color, name: name.trim() || t('online.anon') });
      onOpenGame(ticket.gameId);
    } catch (e) {
      setError(t(e instanceof ApiError && e.code !== 'network' ? 'online.error.create' : 'online.error.network'));
      setBusy(false);
    }
  };

  return (
    <main className="online-lobby">
      <form
        className="online-card"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="analysis-head">
          <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <h1>{t('online.title')}</h1>
        </div>
        <p className="muted online-lede">{t('online.lede')}</p>

        <label className="analysis-field">
          <span>{t('online.name')}</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
        </label>

        <fieldset className="choice-row">
          <legend>{t('newGame.variant')}</legend>
          {listVariants().map((v) => (
            <label key={v.id} className={`chip${variantId === v.id ? ' on' : ''}`}>
              <input
                type="radio"
                name="online-variant"
                checked={variantId === v.id}
                onChange={() => setVariantId(v.id)}
              />
              {vt(v).name}
            </label>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>{t('newGame.time')}</legend>
          {TIME_CONTROLS.map((tc) => (
            <label key={tc.id} className={`chip${timeControlId === tc.id ? ' on' : ''}`}>
              <input
                type="radio"
                name="online-time"
                checked={timeControlId === tc.id}
                onChange={() => setTimeControlId(tc.id)}
              />
              {tc.initialMs === null ? t('time.none') : tc.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>{t('online.color')}</legend>
          {(['w', 'random', 'b'] as const).map((c) => (
            <label key={c} className={`chip${color === c ? ' on' : ''}`}>
              <input type="radio" name="online-color" checked={color === c} onChange={() => setColor(c)} />
              {c === 'random' ? t('online.random') : t(`color.${c}`)}
            </label>
          ))}
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary analysis-go" disabled={busy}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path className="fill" d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          {busy ? t('online.creating') : t('online.create')}
        </button>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// A game: waiting for the opponent, setup choices, play, result.

/** All states of the game from the view (replayed with the engine). */
function statesOf(v: VariantDefinition, view: GameView | null): GameState[] {
  if (!view?.startFen) return [];
  const states = [createGame(v, view.startFen)];
  for (const m of view.moves) {
    const prev = states[states.length - 1];
    const move = findMove(v, prev, m.from, m.to, m.promotion);
    if (!move) break;
    states.push(makeMove(v, prev, move));
  }
  return states;
}

/** The server clock, re-based on local time so ClockView can run it. */
function clockOf(view: GameView, offset: number): ClockState {
  const r = view.clock.remaining;
  return {
    control: timeControl(view.timeControlId),
    remaining: { w: r.w ?? Infinity, b: r.b ?? Infinity },
    running: view.phase === 'playing' ? view.clock.running : null,
    since: view.clock.since + offset,
    stopped: view.phase === 'over',
  };
}

function OnlineGame({ gameId, onLobby, prefs, setPrefs }: Omit<Props, 'gameId'> & { gameId: string }) {
  const { t, vt } = useI18n();
  const [ticket, setTicket] = useState(() => loadTicket(gameId));
  const link = useOnlineGame(gameId, ticket?.token ?? null);
  const { view, offset, status, send } = link;
  const variant = getVariant(view?.variantId ?? listVariants()[0].id);
  const texts = vt(variant);
  const you = view?.you ?? null;

  // Played states; a move just sent is shown at once until the server's answer arrives.
  const confirmed = useMemo(() => statesOf(variant, view), [variant, view]);
  const [pending, setPending] = useState<{ move: Move; ply: number } | null>(null);
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setPending(null);
  }
  const states = useMemo(() => {
    const last = confirmed.at(-1);
    if (!pending || !last || pending.ply !== confirmed.length - 1) return confirmed;
    try {
      return [...confirmed, makeMove(variant, last, pending.move)];
    } catch {
      return confirmed;
    }
  }, [confirmed, pending, variant]);
  const state = states.at(-1) ?? null;

  const [cursor, setCursor] = useState<number | null>(null); // null: follow the game
  const shownIndex = cursor === null ? states.length - 1 : Math.min(cursor, states.length - 1);
  const shown = states[shownIndex] ?? null;
  const atEnd = shownIndex === states.length - 1;

  const [flipped, setFlipped] = useState<boolean | null>(null);
  const isFlipped = flipped ?? you === 'b';
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [copied, setCopied] = useState(false);
  const boardArea = useRef<HTMLDivElement>(null);

  // Sounds for new moves and the end of the game.
  const moveCount = view?.moves.length ?? 0;
  const lastSound = useRef<{ moves: number; over: boolean } | null>(null);
  useEffect(() => {
    if (!view) return;
    const over = view.phase === 'over';
    const before = lastSound.current;
    lastSound.current = { moves: moveCount, over };
    if (!before || !prefs.sound) return;
    if (over && !before.over) playSound('end');
    else if (moveCount > before.moves && state) {
      const lastMove = state.moves.at(-1)?.move;
      playSound(isInCheck(variant, state.position) ? 'check' : lastMove?.captured ? 'capture' : 'move');
    }
  }, [view, moveCount, prefs.sound, state, variant]);

  // Ticks the reconnect countdown while someone is away.
  const [, setTick] = useState(0);
  const someoneAway = !!view && (['w', 'b'] as const).some((c) => view.players[c]?.deadline);
  useEffect(() => {
    if (!someoneAway) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [someoneAway]);

  // Setup answers picked in this tab (sent together once all of this player's questions are answered).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const myQuestions = useMemo(
    () => (variant.setup?.questions ?? []).filter((q) => (q.color ?? 'w') === you),
    [variant, you],
  );
  const open =
    view?.phase === 'setup' ? myQuestions.filter((q) => !view.answered.includes(q.id) && !(q.id in answers)) : [];
  const pick = (questionId: string, optionId: string) => {
    const next = { ...answers, [questionId]: optionId };
    setAnswers(next);
    if (myQuestions.every((q) => q.id in next)) send({ t: 'setup', answers: next });
  };

  if (!view) {
    return (
      <main className="online-lobby">
        <div className="online-card">
          <p className="muted">{status === 'closed' ? t('online.reconnecting') : t('online.connecting')}</p>
        </div>
      </main>
    );
  }

  const top: Color = isFlipped ? 'w' : 'b';
  const bottom = opposite(top);
  const playing = view.phase === 'playing';
  const yourTurn = playing && !!you && state?.position.turn === you && !pending;
  const canJoin = !you && view.phase === 'waiting' && (!view.players.w || !view.players.b);
  const opponent = you ? view.players[opposite(you)] : null;
  const clock = clockOf(view, offset);
  const timed = clock.control.initialMs !== null;
  const control = timeControl(view.timeControlId);

  const play = (move: Move) => {
    const ply = view.moves.length;
    setPending({ move, ply });
    setCursor(null);
    send({
      t: 'move',
      move: { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) },
      ply,
    });
  };
  const onMove = (candidates: Move[]) => (candidates.length > 1 ? setPromotion(candidates) : play(candidates[0]));
  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };

  const shareUrl = `${location.origin}/#online/${gameId}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('copyPrompt'), shareUrl);
    }
  };

  const secondsLeft = (deadline: number | null) =>
    deadline === null ? 0 : Math.max(0, Math.ceil((deadline + offset - Date.now()) / 1000));

  const endText = (o: OnlineOutcome) => {
    if (o.reason === 'abandon') {
      return t('online.abandon', {
        loser: t(`color.${opposite(o.winner!)}`),
        winner: t('outcome.winner', { color: t(`color.${o.winner!}`) }),
      });
    }
    return outcomeText(o as Outcome, t);
  };

  let statusText: string;
  if (view.phase === 'waiting') statusText = t('online.waiting');
  else if (view.phase === 'setup') statusText = open.length ? t('status.setup') : t('online.setupWait');
  else if (view.outcome) statusText = endText(view.outcome);
  else if (!state) statusText = '';
  else {
    const turn = state.position.turn;
    statusText = you
      ? turn === you
        ? t('online.yourTurn')
        : t('online.theirTurn')
      : t('status.turn', { color: t(`color.${turn}`) });
    if (isInCheck(variant, state.position)) statusText += t('status.check');
  }

  const nameOf = (c: Color) => {
    const p = view.players[c];
    if (!p) return t('online.emptySeat');
    const label = p.name || t('online.anon');
    return c === you ? `${label} (${t('online.you')})` : label;
  };

  const sized = prefs.boardSize ? ({ '--board-user': `${prefs.boardSize}px` } as CSSProperties) : undefined;
  const away = (['w', 'b'] as const).filter((c) => playing && view.players[c]?.deadline);

  return (
    <main className="layout">
      <section className={prefs.boardSize ? 'board-wrap sized' : 'board-wrap'} style={sized}>
        <aside className="players" aria-label={t('game.players')}>
          {[top, bottom].map((c, i) => (
            <PlayerRow
              key={c}
              variant={variant}
              color={c}
              player={HUMAN}
              label={nameOf(c)}
              start={states[0]?.position ?? shown?.position ?? createGame(variant).position}
              position={shown?.position ?? createGame(variant).position}
              active={playing && state?.position.turn === c}
              clock={timed ? clock : null}
              place={i === 0 ? 'top' : 'bottom'}
            />
          ))}
        </aside>
        <div className="board-col">
          <div className="board-frame">
            <Splatter className="splatter-tl" />
            <Splatter className="splatter-br" />
            {yourTurn && atEnd && <div className="turn-tape">{t('game.yourTurn')}</div>}
            <div className="board-area" ref={boardArea}>
              <Board
                variant={variant}
                position={shown?.position ?? createGame(variant).position}
                lastMove={shown?.moves.at(-1)?.move ?? null}
                flipped={isFlipped}
                highlight={variant.highlight && shown ? variant.highlight.squares(shown.position) : []}
                bandRanks={variant.highlight?.ranks ?? []}
                disabled={!yourTurn || !atEnd || promotion !== null}
                onMove={onMove}
              />
              {open.length > 0 && (
                <SetupDialog
                  variant={variant}
                  question={open[0]}
                  step={myQuestions.length - open.length}
                  total={myQuestions.length}
                  onPick={(optionId) => pick(open[0].id, optionId)}
                />
              )}
              {promotion && you && (
                <PromotionDialog
                  variant={variant}
                  color={you}
                  options={promotion.map((m) => m.promotion!)}
                  onPick={onPromote}
                  onCancel={() => setPromotion(null)}
                />
              )}
            </div>
            <BoardResizer
              current={() => boardArea.current?.getBoundingClientRect().width ?? 0}
              onResize={(boardSize) => setPrefs((p) => ({ ...p, boardSize }))}
            />
          </div>
          <div className="board-bar">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={prefs.sound}
                onChange={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
              />
              <span className="switch" aria-hidden="true" />
              {t('toolbar.sound')}
            </label>
            <span className={`online-dot ${status}`} role="status">
              {status === 'open' ? t('online.connected') : t('online.reconnecting')}
            </span>
          </div>
        </div>
      </section>

      <aside className="side">
        <div className="box game-box">
          <div className="box-head">
            <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
            <h2>{texts.name}</h2>
            <span className="game-label">
              {t('online.label')} · {control.initialMs === null ? t('time.none') : control.label}
              {!you && ` · ${t('online.spectating')}`}
            </span>
          </div>
          <div
            className={`status${view.outcome || (playing && state && isInCheck(variant, state.position)) ? ' alert' : ''}`}
          >
            {statusText}
          </div>
          {link.error && <div className="notice">{t(`online.error.${link.error}`)}</div>}
        </div>

        {view.phase === 'waiting' && you && (
          <div className="box online-invite">
            <p>{t('online.invite')}</p>
            <div className="fen-row">
              <input
                readOnly
                value={shareUrl}
                aria-label={t('online.link')}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button onClick={copyLink}>{copied ? t('controls.copied') : t('analysisPage.copy')}</button>
            </div>
          </div>
        )}

        {canJoin && <JoinCard gameId={gameId} host={view} onJoined={setTicket} />}

        {away.map((c) => (
          <div key={c} className="online-away" role="alert">
            {t('online.away', { name: nameOf(c), seconds: secondsLeft(view.players[c]!.deadline) })}
          </div>
        ))}

        {playing && you && (
          <div className="controls">
            {view.drawOffer === opposite(you) ? (
              <>
                <button className="control lime" onClick={() => send({ t: 'draw', action: 'accept' })}>
                  {t('online.drawAccept')}
                </button>
                <button className="control" onClick={() => send({ t: 'draw', action: 'decline' })}>
                  {t('online.drawDecline')}
                </button>
              </>
            ) : (
              <button
                className="control"
                disabled={view.drawOffer === you}
                onClick={() => send({ t: 'draw', action: 'offer' })}
              >
                {view.drawOffer === you ? t('online.drawOffered') : t('controls.draw')}
              </button>
            )}
            <button
              className="control danger"
              onClick={() => {
                if (window.confirm(t('online.resignConfirm'))) send({ t: 'resign' });
              }}
            >
              {t('controls.resign')}
            </button>
            {opponent && !opponent.connected && !away.length && (
              <p className="muted online-note">{t('online.opponentOffline')}</p>
            )}
          </div>
        )}

        {view.phase === 'over' && states.length > 1 && (
          <button className="primary analyse-button" onClick={() => setShowAnalysis(true)}>
            {t('analysis.button')}
          </button>
        )}
        {(view.phase === 'over' || !you) && (
          <button className="primary new-game-button" onClick={onLobby}>
            {t('online.newGame')}
          </button>
        )}

        <div className="box">
          <div className="tab-body">
            {state ? (
              <MoveList
                game={state}
                cursor={shownIndex}
                onSelect={(c) => setCursor(c >= states.length - 1 ? null : c)}
              />
            ) : (
              <p className="muted">{t('moves.none')}</p>
            )}
          </div>
          <div className="tools">
            <button
              className="tool"
              onClick={() => setFlipped(!isFlipped)}
              aria-label={t('controls.flip')}
              title={t('controls.flip')}
            >
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
              </svg>
            </button>
            <button
              className="tool"
              onClick={() => setCursor(Math.max(0, shownIndex - 1))}
              disabled={shownIndex === 0}
              aria-label={t('nav.back')}
              title={t('nav.back')}
            >
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button
              className="tool"
              onClick={() => setCursor(shownIndex + 1 >= states.length - 1 ? null : shownIndex + 1)}
              disabled={atEnd}
              aria-label={t('nav.forward')}
              title={t('nav.forward')}
            >
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {showAnalysis && (
        <Modal label={t('analysis.dialog')} className="viewer-modal" onClose={() => setShowAnalysis(false)}>
          <GameViewer
            variant={variant}
            states={states}
            autoAnalyse
            title={
              <>
                <h2>{t('analysis.title')}</h2>
                <p className="muted">
                  {nameOf('w')} – {nameOf('b')}
                </p>
              </>
            }
          >
            <button onClick={() => setShowAnalysis(false)}>{t('close')}</button>
          </GameViewer>
        </Modal>
      )}
    </main>
  );
}

/** Invitation to take the free seat of a waiting game. */
function JoinCard({
  gameId,
  host,
  onJoined,
}: {
  gameId: string;
  host: GameView;
  onJoined: (t: ReturnType<typeof loadTicket>) => void;
}) {
  const { t, vt } = useI18n();
  const [name, setName] = useState(loadName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creator = host.players.w ?? host.players.b;
  const join = async () => {
    setBusy(true);
    setError(null);
    saveName(name.trim());
    try {
      onJoined(await joinOnlineGame(gameId, name.trim() || t('online.anon')));
    } catch (e) {
      setError(t(e instanceof ApiError && e.code === 'full' ? 'online.error.full' : 'online.error.network'));
      setBusy(false);
    }
  };
  const control = timeControl(host.timeControlId);
  return (
    <form
      className="box online-invite"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <p>
        {t('online.invited', {
          name: creator?.name || t('online.anon'),
          variant: vt(getVariant(host.variantId)).name,
          time: control.initialMs === null ? t('time.none') : control.label,
        })}
      </p>
      <label className="analysis-field">
        <span>{t('online.name')}</span>
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary analysis-go" disabled={busy}>
        {t('online.join')}
      </button>
    </form>
  );
}
