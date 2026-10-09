import { useEffect, useRef, useState } from 'react';
import { isInCheck, opposite, toFen } from '../engine/index.ts';
import type { Color, Move, PieceType } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { ClockView } from './ClockView.tsx';
import { GameControls } from './GameControls.tsx';
import { GameViewer } from './GameViewer.tsx';
import { HistoryModal } from './HistoryModal.tsx';
import { MoveList } from './MoveList.tsx';
import { NewGameDialog } from './NewGameDialog.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { RuleCardModal } from './RuleCardModal.tsx';
import { SetupDialog } from './SetupDialog.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useAssistant, useBotClients, useBotPlayer, useClockTicker, useGame, useGameFeedback } from './game/hooks.ts';
import { COLOR_NAME, botName, newSession, outcomeText } from './game/session.ts';
import { applyUpdate, onUpdateReady } from '../pwa/register.ts';
import { applyPrefs, loadPrefs, savePrefs } from './prefs.ts';
import type { Prefs } from './prefs.ts';
import { isRuleCardHidden, loadSettings, saveSettings } from './settings.ts';
import type { GameSettings } from './settings.ts';
import { playSound } from './sound.ts';
import type { SoundKind } from './sound.ts';

export function App() {
  const { session, view, dispatch } = useGame(() => newSession(loadSettings(), 1));
  const [showNewGame, setShowNewGame] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  // A new app version is installed and waiting (service worker): offer a reload.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);
  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);
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
  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(fen);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Konum metni:', fen);
    }
  };

  const humanToMove = toMove.kind === 'human';
  const boardDisabled =
    !!outcome || promotion !== null || setup !== null || !humanToMove || (!atEnd && (vsBot || timed));
  // Premoves: against the bot, while it is the bot's turn and the game is on.
  const premoveColor: Color | null =
    vsBot && humanColor && !humanToMove && !outcome && !setup && atEnd && promotion === null ? humanColor : null;

  let status: string;
  if (outcome) status = outcomeText(outcome);
  else if (setup) status = 'Oyun öncesi seçim bekleniyor…';
  else if (thinking) status = `${COLOR_NAME[turn]} bot (${botName(toMove)}) düşünüyor…`;
  else if (watching && session.run === 'pause') status = `Duraklatıldı — sıra: ${COLOR_NAME[turn]}`;
  else status = `Sıra: ${COLOR_NAME[turn]}${isInCheck(variant, game.position) ? ' — Şah!' : ''}`;

  return (
    <div className="app">
      {updateReady && (
        <div className="update-bar" role="status">
          Yeni sürüm hazır.{' '}
          <button className="primary" onClick={applyUpdate}>
            Yenile
          </button>
        </div>
      )}
      <Toolbar
        label={`${variant.name} · ${settings.mode === 'hotseat' ? 'İki kişi' : `${botName(players.w)} – ${botName(players.b)}`}`}
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
          {notice && <div className="notice">{notice}</div>}
          {view.finalOutcome && view.endState.moves.length > 0 && (
            <button className="primary analyse-button" onClick={() => setShowAnalysis(true)}>
              Oyunu analiz et
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
            highlightLabel={variant.highlight?.label ?? null}
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
          />
        </section>

        <aside className="side">
          <div className="panel">
            <h2>{variant.name}</h2>
            <ul className="rules">
              {variant.description.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h2>Hamleler</h2>
            <MoveList
              game={view.endState}
              cursor={timeline.cursor}
              onSelect={vsBot ? () => {} : (cursor) => dispatch({ type: 'goTo', cursor })}
            />
          </div>
          <div className="panel">
            <h2>Konum</h2>
            <code className="fen">{fen}</code>
          </div>
        </aside>
      </main>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showAnalysis && (
        <div className="modal-backdrop screen" onClick={() => setShowAnalysis(false)}>
          <div className="modal history" role="dialog" aria-label="Oyun analizi" onClick={(e) => e.stopPropagation()}>
            <h2>Analiz</h2>
            <GameViewer variant={variant} states={timeline.states} autoAnalyse>
              <button onClick={() => setShowAnalysis(false)}>Kapat</button>
            </GameViewer>
          </div>
        </div>
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
