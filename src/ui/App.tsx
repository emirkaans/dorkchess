import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { getVariant, isInCheck, opposite, toFen } from '../engine/index.ts';
import type { Color, Move, PieceType } from '../engine/index.ts';
import { AnalysisPage } from './AnalysisPage.tsx';
import type { AnalysisSeed } from './AnalysisPage.tsx';
import { Board } from './Board.tsx';
import { BoardResizer } from './BoardResizer.tsx';
import { GameControls, GameTools } from './GameControls.tsx';
import { GameViewer } from './GameViewer.tsx';
import { HistoryModal } from './HistoryModal.tsx';
import { HomePage } from './HomePage.tsx';
import { Modal } from './Modal.tsx';
import { MoveList } from './MoveList.tsx';
import { NewGameDialog } from './NewGameDialog.tsx';
import { OnlinePage } from './online/OnlinePage.tsx';
import { PlayerRow } from './PlayerRow.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { Splatter } from './Punk.tsx';
import { RuleCardModal } from './RuleCardModal.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { SetupDialog } from './SetupDialog.tsx';
import { SharePanel } from './ShareTools.tsx';
import { GearIcon, Toolbar } from './Toolbar.tsx';
import type { Page } from './Toolbar.tsx';
import { useAssistant, useBotClients, useBotPlayer, useClockTicker, useGame, useGameFeedback } from './game/hooks.ts';
import { botName, newSession, outcomeText, resultCode } from './game/session.ts';
import { errorText } from '../i18n/index.ts';
import { I18nProvider, useI18n } from './i18n.tsx';
import { applyUpdate, onUpdateReady } from '../pwa/register.ts';
import { decodeLink } from '../storage/share.ts';
import type { GameState } from '../engine/index.ts';
import { TIME_CONTROLS } from '../clock/clock.ts';
import { applyPrefs, loadPrefs, savePrefs } from './prefs.ts';
import type { Prefs } from './prefs.ts';
import { isRuleCardHidden, loadSettings, saveSettings } from './settings.ts';
import type { GameSettings } from './settings.ts';
import { playSound } from './sound.ts';
import type { SoundKind } from './sound.ts';

/** Variant of a list of game states (all states of one game share it). */
const variantOf = (states: readonly GameState[]) => getVariant(states[0].variantId);

type Tab = 'moves' | 'variant' | 'position';

/** Holds the preferences (themes, sound, language) and provides the language to the whole app. */
export function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);
  return (
    <I18nProvider locale={prefs.locale}>
      <GameScreen prefs={prefs} setPrefs={setPrefs} />
    </I18nProvider>
  );
}

function GameScreen({ prefs, setPrefs }: { prefs: Prefs; setPrefs: Dispatch<SetStateAction<Prefs>> }) {
  const { t, vt } = useI18n();
  const { session, view, dispatch } = useGame(() => newSession(loadSettings(), 1));
  const [page, setPage] = useState<Page>('home');
  /** Online game shown on the online page (null: its lobby). */
  const [onlineId, setOnlineId] = useState<string | null>(null);
  /** Settings the new game dialog opens with (null: closed). */
  const [newGame, setNewGame] = useState<GameSettings | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [tab, setTab] = useState<Tab>('moves');
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  /** Game sent to the analysis board (from a viewer, the game page or an online game). */
  const [analysisSeed, setAnalysisSeed] = useState<AnalysisSeed | null>(null);
  /** A game opened from a shared link (shown in the viewer). */
  const [sharedGame, setSharedGame] = useState<readonly GameState[] | null>(null);
  const [showHighlight, setShowHighlight] = useState(true);
  const boardArea = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A new app version is installed and waiting (service worker): offer a reload.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);
  const soundOn = useRef(prefs.sound);
  useEffect(() => {
    soundOn.current = prefs.sound;
  }, [prefs.sound]);
  const [sound] = useState(() => (kind: SoundKind) => {
    if (soundOn.current) playSound(kind);
  });

  const clients = useBotClients();
  // The bot waits while a dialog is open or another page is shown.
  const paused = newGame !== null || showRules || page !== 'game';
  const thinking = useBotPlayer(session, view, dispatch, clients.bot, paused, setNotice);
  useClockTicker(session, view, dispatch, sound);
  useGameFeedback(session, view, sound);
  const assistant = useAssistant(session, view, dispatch, clients, setNotice);

  // Any new move (or a new game) clears the last notice.
  const moveCount = session.timeline.states.length;
  useEffect(() => setNotice(null), [session.key, moveCount]);

  const { settings, players, timeline, setup } = session;
  const { variant, game, atEnd, outcome, turn, toMove, vsBot, watching, humanColor, timed } = view;
  const now = () => Date.now();

  const openNewGame = (patch: Partial<GameSettings> = {}) => setNewGame({ ...settings, ...patch });
  // "Play": back to the running game, or a new one if none was started yet.
  const goPlay = () => (session.key > 1 ? setPage('game') : openNewGame());

  const startGame = (s: GameSettings) => {
    saveSettings(s);
    clients.bot.stop();
    clients.helper.stop();
    const next = newSession(s, session.key + 1);
    dispatch({ type: 'start', session: next });
    setFlipped(next.players.w.kind === 'bot' && next.players.b.kind === 'human');
    setPromotion(null);
    setNewGame(null);
    setPage('game');
    setTab('moves');
    setShowRules(!isRuleCardHidden(s.variantId));
  };

  const play = (move: Move) => dispatch({ type: 'move', move, key: session.key, now: now() });
  const onMove = (candidates: Move[]) => (candidates.length > 1 ? setPromotion(candidates) : play(candidates[0]));
  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };
  const undoPair = () => {
    clients.bot.stop();
    dispatch({ type: 'undoPair' });
  };
  const resign = () => {
    clients.bot.stop();
    const loser = humanColor ?? turn;
    dispatch({ type: 'end', outcome: { reason: 'resign', winner: opposite(loser) }, key: session.key, now: now() });
  };

  const fen = toFen(variant, game.position);
  const openAnalysis = (variantId: string, states: readonly GameState[], cursor: number) => {
    setAnalysisSeed({ key: Date.now(), variantId, states, cursor });
    setShowAnalysis(false);
    setSharedGame(null);
    setShowHistory(false);
    setPage('analysis');
  };
  // Opening a shared link: a game goes to the viewer, a position starts a two-player game from it.
  const openLinkRef = useRef<() => void>(() => {});
  useEffect(() => {
    openLinkRef.current = () => {
      // An online game link: #online/<id>.
      const online = /^#online\/([A-Za-z0-9]{8})$/.exec(location.hash);
      if (online) {
        setOnlineId(online[1]);
        setPage('online');
        return;
      }
      let link;
      try {
        link = decodeLink(location.hash);
      } catch (e) {
        setNotice(t('notice.linkError', { reason: errorText(e, t) }));
        setPage('game');
        history.replaceState(null, '', location.pathname + location.search);
        return;
      }
      if (!link) return;
      history.replaceState(null, '', location.pathname + location.search);
      if (link.kind === 'game') {
        setSharedGame(link.states);
        return;
      }
      const s: GameSettings = { ...loadSettings(), mode: 'hotseat', variantId: link.variantId, timeControl: 'none' };
      clients.bot.stop();
      dispatch({ type: 'start', session: newSession(s, session.key + 1, Math.random, link.fen) });
      setNewGame(null);
      setPage('game');
      setFlipped(false);
    };
  });
  useEffect(() => {
    const open = () => openLinkRef.current();
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  // The address bar shows the open online game (so it can be reloaded or shared), and nothing elsewhere.
  useEffect(() => {
    const want = page === 'online' && onlineId ? `#online/${onlineId}` : '';
    const isOnline = location.hash.startsWith('#online');
    if (want && location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
    else if (!want && isOnline) history.replaceState(null, '', location.pathname + location.search);
  }, [page, onlineId]);

  const humanToMove = toMove.kind === 'human';
  const boardDisabled =
    !!outcome || promotion !== null || setup !== null || !humanToMove || (!atEnd && (vsBot || timed));
  // Premoves: against the bot, while it is the bot's turn and the game is on.
  const premoveColor: Color | null =
    vsBot && humanColor && !humanToMove && !outcome && !setup && atEnd && promotion === null ? humanColor : null;

  // Text for screen readers: who played what, then how the game ended.
  const lastPlayed = view.endState.moves.at(-1);
  const mover = view.endState.position.turn === 'w' ? 'b' : 'w';
  const announcement = [
    lastPlayed ? t('announceMove', { color: t(`color.${mover}`), san: lastPlayed.san }) : '',
    view.finalOutcome ? outcomeText(view.finalOutcome, t) : '',
  ]
    .filter(Boolean)
    .join('. ');

  const inCheck = isInCheck(variant, game.position);
  let status: string;
  const turnName = t(`color.${turn}`);
  if (outcome) status = outcomeText(outcome, t);
  else if (setup) status = t('status.setup');
  else if (thinking) status = t('status.thinking', { color: turnName, name: botName(toMove, t) });
  else if (watching && session.run === 'pause') status = t('status.paused', { color: turnName });
  else status = t('status.turn', { color: turnName }) + (inCheck ? t('status.check') : '');
  const texts = vt(variant);

  // Against the bot: a tape on the board when it is the human's move.
  const yourTurn = vsBot && humanToMove && !outcome && !setup && atEnd;

  const top: Color = flipped ? 'w' : 'b';
  const bottom: Color = flipped ? 'b' : 'w';
  const start = timeline.states[0].position;
  const timeControl = TIME_CONTROLS.find((tc) => tc.id === settings.timeControl);
  const gameLabel = [
    texts.name,
    settings.mode === 'hotseat' ? t('mode.hotseatShort') : `${botName(players.w, t)} – ${botName(players.b, t)}`,
    timeControl && timed ? timeControl.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="app">
      {updateReady && (
        <div className="update-bar" role="status">
          {t('update.ready')}{' '}
          <button className="primary" onClick={applyUpdate}>
            {t('update.reload')}
          </button>
        </div>
      )}
      <Toolbar
        page={page}
        prefs={prefs}
        onPrefs={setPrefs}
        onHome={() => setPage('home')}
        onPlay={goPlay}
        onAnalysis={() => setPage('analysis')}
        onOnline={() => setPage('online')}
        onHistory={() => setShowHistory(true)}
        onSettings={() => setShowSettings(true)}
      />

      {page === 'home' ? (
        <HomePage onPlay={openNewGame} />
      ) : page === 'analysis' ? (
        <AnalysisPage key={analysisSeed?.key ?? 0} initialVariantId={settings.variantId} seed={analysisSeed} />
      ) : page === 'online' ? (
        <OnlinePage
          gameId={onlineId}
          onOpenGame={setOnlineId}
          onLobby={() => setOnlineId(null)}
          prefs={prefs}
          setPrefs={setPrefs}
          defaultVariantId={settings.variantId}
          onOpenAnalysis={openAnalysis}
        />
      ) : (
        <main className="layout">
          <section
            className={prefs.boardSize ? 'board-wrap sized' : 'board-wrap'}
            style={prefs.boardSize ? ({ '--board-user': `${prefs.boardSize}px` } as CSSProperties) : undefined}
          >
            {/* Players and clocks: a column left of the board that stays on screen. */}
            <aside className="players" aria-label={t('game.players')}>
              <PlayerRow
                variant={variant}
                color={top}
                player={players[top]}
                start={start}
                position={game.position}
                active={!outcome && !setup && turn === top}
                clock={timed ? session.clock : null}
                place="top"
              />
              <PlayerRow
                variant={variant}
                color={bottom}
                player={players[bottom]}
                start={start}
                position={game.position}
                active={!outcome && !setup && turn === bottom}
                clock={timed ? session.clock : null}
                place="bottom"
              />
            </aside>
            <div className="board-col">
              <div className="board-frame">
                <Splatter className="splatter-tl" />
                <Splatter className="splatter-br" />
                {yourTurn && <div className="turn-tape">{t('game.yourTurn')}</div>}
                <div className="board-area" ref={boardArea}>
                  <Board
                    variant={variant}
                    position={game.position}
                    lastMove={game.moves.at(-1)?.move ?? null}
                    flipped={flipped}
                    highlight={showHighlight && variant.highlight ? variant.highlight.squares(game.position) : []}
                    bandRanks={variant.highlight?.ranks ?? []}
                    arrows={assistant.hintArrow ? [assistant.hintArrow] : []}
                    disabled={boardDisabled}
                    premoveColor={premoveColor}
                    premove={session.premove}
                    onPremove={(p) => dispatch({ type: 'premove', premove: p })}
                    onCancelPremove={() => dispatch({ type: 'premove', premove: null })}
                    onMove={onMove}
                  />
                  {setup && (
                    <SetupDialog
                      variant={variant}
                      question={setup.questions[setup.step]}
                      step={setup.step}
                      total={setup.questions.length}
                      onPick={(optionId) => dispatch({ type: 'setupAnswer', optionId })}
                    />
                  )}
                  {promotion && (
                    <PromotionDialog
                      variant={variant}
                      color={turn}
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
                <button className="bar-button" onClick={() => setShowRules(true)}>
                  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 4h11l5 5v11H4z" />
                    <path d="M8 12h8M8 16h5" />
                  </svg>
                  {t('toolbar.rules')}
                </button>
                <button className="bar-button" onClick={() => setShowSettings(true)}>
                  <GearIcon />
                  {t('toolbar.settings')}
                </button>
                <span className="bar-slogan" aria-hidden="true">
                  {t('home.slogan1')} {t('home.slogan2')} {t('home.slogan3')}
                </span>
              </div>
              {/* Screen readers: the last move and the result are announced. */}
              <div className="sr-only" aria-live="polite">
                {announcement}
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
                <span className="game-label">{gameLabel}</span>
              </div>
              <div className={`status${thinking ? ' thinking' : ''}${outcome || (inCheck && !setup) ? ' alert' : ''}`}>
                {status}
              </div>
              {notice && <div className="notice">{notice}</div>}
            </div>

            {view.finalOutcome && view.endState.moves.length > 0 && (
              <button className="primary analyse-button" onClick={() => setShowAnalysis(true)}>
                {t('analysis.button')}
              </button>
            )}
            <GameControls
              vsBot={vsBot}
              watching={watching}
              over={!!outcome}
              setupPending={!!setup}
              // With a clock, taking back moves and hints are off.
              canUndo={vsBot && !timed && timeline.states.length > 1}
              hintEnabled={!timed && humanToMove && !outcome && !setup}
              hintBusy={assistant.hintBusy}
              run={session.run}
              atEnd={atEnd}
              highlightLabel={texts.highlightLabel}
              showHighlight={showHighlight}
              onUndo={undoPair}
              onHint={assistant.askHint}
              onDraw={assistant.offerDraw}
              onResign={resign}
              onRun={(run) => dispatch({ type: 'run', run })}
              onToggleHighlight={() => setShowHighlight((h) => !h)}
            />
            <button className="primary new-game-button" onClick={() => openNewGame()}>
              <svg className="ic bolt-ic" viewBox="0 0 24 24" aria-hidden="true">
                <path className="fill" d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
              {t('toolbar.newGame')}
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </button>

            <div className="box">
              <div className="tabs" role="tablist" aria-label={t('game.tabs')}>
                {(
                  [
                    ['moves', t('panel.moves')],
                    ['variant', t('game.variantTab')],
                    ['position', t('panel.position')],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? 'tab on' : 'tab'}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="tab-body" role="tabpanel">
                {tab === 'moves' && (
                  <MoveList
                    game={view.endState}
                    cursor={timeline.cursor}
                    onSelect={vsBot ? () => {} : (cursor) => dispatch({ type: 'goTo', cursor })}
                  />
                )}
                {tab === 'variant' && (
                  <ul className="rules">
                    {texts.description.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {tab === 'position' && <code className="fen">{fen}</code>}
              </div>
              <GameTools
                canBrowse={!vsBot}
                canBack={timeline.cursor > 0}
                canForward={!atEnd}
                onBack={() => dispatch({ type: 'goTo', cursor: timeline.cursor - 1 })}
                onForward={() => dispatch({ type: 'goTo', cursor: timeline.cursor + 1 })}
                onFlip={() => setFlipped((f) => !f)}
              />
            </div>
            <SharePanel
              variant={variant}
              states={timeline.states}
              cursor={timeline.cursor}
              meta={{
                white: botName(players.w, t),
                black: botName(players.b, t),
                result: view.finalOutcome ? resultCode(view.finalOutcome) : '*',
              }}
              onOpenAnalysis={() => openAnalysis(variant.id, timeline.states, timeline.cursor)}
            />
          </aside>
        </main>
      )}

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onOpenAnalysis={openAnalysis} />}
      {showSettings && <SettingsDialog prefs={prefs} onPrefs={setPrefs} onClose={() => setShowSettings(false)} />}
      {sharedGame && (
        <Modal label={t('analysis.shared')} className="viewer-modal" onClose={() => setSharedGame(null)}>
          <GameViewer
            variant={variantOf(sharedGame)}
            states={sharedGame}
            title={
              <h2>
                {t('analysis.shared')} · {vt(variantOf(sharedGame)).name}
              </h2>
            }
            onOpenAnalysis={(states, cursor) => openAnalysis(sharedGame[0].variantId, states, cursor)}
          >
            <button onClick={() => setSharedGame(null)}>{t('close')}</button>
          </GameViewer>
        </Modal>
      )}
      {showAnalysis && (
        <Modal label={t('analysis.dialog')} className="viewer-modal" onClose={() => setShowAnalysis(false)}>
          <GameViewer
            variant={variant}
            states={timeline.states}
            autoAnalyse
            title={
              <>
                <h2>{t('analysis.title')}</h2>
                <p className="muted">{gameLabel}</p>
              </>
            }
            meta={{
              white: botName(players.w, t),
              black: botName(players.b, t),
              result: view.finalOutcome ? resultCode(view.finalOutcome) : '*',
            }}
            onOpenAnalysis={(states, cursor) => openAnalysis(variant.id, states, cursor)}
          >
            <button onClick={() => setShowAnalysis(false)}>{t('close')}</button>
          </GameViewer>
        </Modal>
      )}
      {showRules && <RuleCardModal variant={variant} onClose={() => setShowRules(false)} />}
      {newGame && <NewGameDialog initial={newGame} onStart={startGame} onCancel={() => setNewGame(null)} />}
    </div>
  );
}
