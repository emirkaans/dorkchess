import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getVariant, isInCheck, opposite, toFen } from '../engine/index.ts';
import type { Color, Move, PieceType } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { ClockView } from './ClockView.tsx';
import { GameControls } from './GameControls.tsx';
import { GameViewer } from './GameViewer.tsx';
import { HistoryModal } from './HistoryModal.tsx';
import { Modal } from './Modal.tsx';
import { MoveList } from './MoveList.tsx';
import { NewGameDialog } from './NewGameDialog.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { RuleCardModal } from './RuleCardModal.tsx';
import { SetupDialog } from './SetupDialog.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useAssistant, useBotClients, useBotPlayer, useClockTicker, useGame, useGameFeedback } from './game/hooks.ts';
import { botName, newSession, outcomeText } from './game/session.ts';
import { errorText } from '../i18n/index.ts';
import { I18nProvider, useI18n } from './i18n.tsx';
import { applyUpdate, onUpdateReady } from '../pwa/register.ts';
import { decodeLink, encodeGame, encodePosition } from '../storage/share.ts';
import type { GameState } from '../engine/index.ts';
import { applyPrefs, loadPrefs, savePrefs } from './prefs.ts';
import type { Prefs } from './prefs.ts';
import { isRuleCardHidden, loadSettings, saveSettings } from './settings.ts';
import type { GameSettings } from './settings.ts';
import { playSound } from './sound.ts';
import type { SoundKind } from './sound.ts';

/** Variant of a list of game states (all states of one game share it). */
const variantOf = (states: readonly GameState[]) => getVariant(states[0].variantId);

/** Holds the preferences (theme, sound, language) and provides the language to the whole app. */
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
  const [showNewGame, setShowNewGame] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [copied, setCopied] = useState<'fen' | 'game' | 'position' | null>(null);
  /** A game opened from a shared link (shown in the viewer). */
  const [sharedGame, setSharedGame] = useState<readonly GameState[] | null>(null);
  const [showHighlight, setShowHighlight] = useState(true);
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
  const thinking = useBotPlayer(session, view, dispatch, clients.bot, showNewGame || showRules, setNotice);
  useClockTicker(session, view, dispatch, sound);
  useGameFeedback(session, view, sound);
  const assistant = useAssistant(session, view, dispatch, clients, setNotice);

  // Any new move (or a new game) clears the last notice.
  const moveCount = session.timeline.states.length;
  useEffect(() => setNotice(null), [session.key, moveCount]);

  const { settings, players, timeline, setup } = session;
  const { variant, game, atEnd, outcome, turn, toMove, vsBot, watching, humanColor, timed } = view;
  const now = () => Date.now();

  const startGame = (s: GameSettings) => {
    saveSettings(s);
    clients.bot.stop();
    clients.helper.stop();
    const next = newSession(s, session.key + 1);
    dispatch({ type: 'start', session: next });
    setFlipped(next.players.w.kind === 'bot' && next.players.b.kind === 'human');
    setPromotion(null);
    setShowNewGame(false);
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
  const copyText = async (text: string, what: 'fen' | 'game' | 'position') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt(t('copyPrompt'), text);
    }
  };
  const copyFen = () => copyText(fen, 'fen');
  const copyLink = (kind: 'game' | 'position') => {
    const hash =
      kind === 'game'
        ? encodeGame({
            variantId: variant.id,
            startFen: toFen(variant, timeline.states[0].position),
            moves: view.endState.moves.map((m) => m.san),
          })
        : encodePosition(variant.id, fen);
    void copyText(location.origin + location.pathname + hash, kind);
  };

  // Opening a shared link: a game goes to the viewer, a position starts a two-player game from it.
  const openLinkRef = useRef<() => void>(() => {});
  useEffect(() => {
    openLinkRef.current = () => {
      let link;
      try {
        link = decodeLink(location.hash);
      } catch (e) {
        setNotice(t('notice.linkError', { reason: errorText(e, t) }));
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
      setShowNewGame(false);
      setFlipped(false);
    };
  });
  useEffect(() => {
    const open = () => openLinkRef.current();
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

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

  let status: string;
  const turnName = t(`color.${turn}`);
  if (outcome) status = outcomeText(outcome, t);
  else if (setup) status = t('status.setup');
  else if (thinking) status = t('status.thinking', { color: turnName, name: botName(toMove, t) });
  else if (watching && session.run === 'pause') status = t('status.paused', { color: turnName });
  else status = t('status.turn', { color: turnName }) + (isInCheck(variant, game.position) ? t('status.check') : '');
  const texts = vt(variant);

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
        label={`${texts.name} · ${settings.mode === 'hotseat' ? t('mode.hotseatShort') : `${botName(players.w, t)} – ${botName(players.b, t)}`}`}
        prefs={prefs}
        onPrefs={setPrefs}
        onRules={() => setShowRules(true)}
        onHistory={() => setShowHistory(true)}
        onNewGame={() => setShowNewGame(true)}
      />

      <main className="layout">
        <section className="board-wrap">
          {timed && <ClockView clock={session.clock} color={flipped ? 'w' : 'b'} players={players} />}
          <div className="board-area">
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
          {timed && <ClockView clock={session.clock} color={flipped ? 'b' : 'w'} players={players} />}
          <div className={`status${thinking ? ' thinking' : ''}`}>{status}</div>
          {/* Screen readers: the last move and the result are announced. */}
          <div className="sr-only" aria-live="polite">
            {announcement}
          </div>
          {notice && <div className="notice">{notice}</div>}
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
            canBack={timeline.cursor > 0}
            canForward={!atEnd}
            hintEnabled={!timed && humanToMove && !outcome && !setup}
            hintBusy={assistant.hintBusy}
            run={session.run}
            atEnd={atEnd}
            highlightLabel={texts.highlightLabel}
            showHighlight={showHighlight}
            copied={copied}
            onUndo={undoPair}
            onBack={() => dispatch({ type: 'goTo', cursor: timeline.cursor - 1 })}
            onForward={() => dispatch({ type: 'goTo', cursor: timeline.cursor + 1 })}
            onHint={assistant.askHint}
            onDraw={assistant.offerDraw}
            onResign={resign}
            onRun={(run) => dispatch({ type: 'run', run })}
            onFlip={() => setFlipped((f) => !f)}
            onToggleHighlight={() => setShowHighlight((h) => !h)}
            onCopy={copyFen}
            onCopyLink={copyLink}
            hasMoves={view.endState.moves.length > 0}
          />
        </section>

        <aside className="side">
          <div className="panel">
            <h2>{texts.name}</h2>
            <ul className="rules">
              {texts.description.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h2>{t('panel.moves')}</h2>
            <MoveList
              game={view.endState}
              cursor={timeline.cursor}
              onSelect={vsBot ? () => {} : (cursor) => dispatch({ type: 'goTo', cursor })}
            />
          </div>
          <div className="panel">
            <h2>{t('panel.position')}</h2>
            <code className="fen">{fen}</code>
          </div>
        </aside>
      </main>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {sharedGame && (
        <Modal label={t('analysis.shared')} className="history" onClose={() => setSharedGame(null)}>
          <h2>
            {t('analysis.shared')} · {vt(variantOf(sharedGame)).name}
          </h2>
          <GameViewer variant={variantOf(sharedGame)} states={sharedGame}>
            <button onClick={() => setSharedGame(null)}>{t('close')}</button>
          </GameViewer>
        </Modal>
      )}
      {showAnalysis && (
        <Modal label={t('analysis.dialog')} className="history" onClose={() => setShowAnalysis(false)}>
          <h2>{t('analysis.title')}</h2>
          <GameViewer variant={variant} states={timeline.states} autoAnalyse>
            <button onClick={() => setShowAnalysis(false)}>{t('close')}</button>
          </GameViewer>
        </Modal>
      )}
      {showRules && <RuleCardModal variant={variant} onClose={() => setShowRules(false)} />}
      {showNewGame && (
        <NewGameDialog
          initial={settings}
          onStart={startGame}
          onCancel={session.key > 1 ? () => setShowNewGame(false) : undefined}
        />
      )}
    </div>
  );
}
