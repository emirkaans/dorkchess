import { useEffect, useRef, useState } from 'react';
import { BotCancelled, BotClient } from '../ai/client.ts';
import { HINT, acceptsDraw, botTimeMs, levelConfig } from '../ai/levels.ts';
import {
  createClock,
  flagged,
  isTimed,
  pressClock,
  remainingMs,
  stopClock,
  timeControl,
  timeoutWinner,
} from '../clock/clock.ts';
import type { ClockState } from '../clock/clock.ts';
import {
  createGame,
  getVariant,
  isInCheck,
  legalMoves,
  makeMove,
  opposite,
  setupStartPosition,
  toFen,
} from '../engine/index.ts';
import type {
  Color,
  GameEndReason,
  GameState,
  Move,
  PieceType,
  SetupQuestion,
  Square,
  VariantDefinition,
} from '../engine/index.ts';
import { Board } from './Board.tsx';
import type { Premove } from './Board.tsx';
import { ClockView } from './ClockView.tsx';
import { MoveList } from './MoveList.tsx';
import { NewGameDialog } from './NewGameDialog.tsx';
import { PromotionDialog } from './PromotionDialog.tsx';
import { RuleCardModal } from './RuleCardModal.tsx';
import { HistoryModal } from './HistoryModal.tsx';
import { BOARD_THEMES, UI_MODES, applyPrefs, loadPrefs, savePrefs } from './prefs.ts';
import type { BoardTheme, Prefs, UiMode } from './prefs.ts';
import { playSound } from './sound.ts';
import type { SoundKind } from './sound.ts';
import { newGameId, storeGame } from '../storage/games.ts';
import type { ResultCode } from '../storage/games.ts';
import { LOW_TIME_MS } from '../clock/clock.ts';
import { SetupDialog } from './SetupDialog.tsx';
import { MODE_NAMES, isRuleCardHidden, loadSettings, saveSettings } from './settings.ts';
import type { GameSettings } from './settings.ts';

const COLOR_NAME = { w: 'Beyaz', b: 'Siyah' } as const;

type Player = { readonly kind: 'human' } | { readonly kind: 'bot'; readonly level: number };

/** How a game ended: the engine's reasons plus the ones decided outside the rules. */
type EndReason = GameEndReason | 'resign' | 'agreement' | 'timeout';

interface Outcome {
  readonly reason: EndReason;
  readonly winner: Color | null;
}

function outcomeText(o: Outcome): string {
  const winner = o.winner ? `${COLOR_NAME[o.winner]} kazandı.` : '';
  switch (o.reason) {
    case 'checkmate':
      return `Mat! ${winner}`;
    case 'stalemate':
      return 'Pat — berabere.';
    case 'fifty-move':
      return '50 hamle kuralı — berabere.';
    case 'threefold':
      return 'Üç kez tekrar — berabere.';
    case 'insufficient':
      return 'Yetersiz materyal — berabere.';
    case 'resign':
      return `${COLOR_NAME[opposite(o.winner!)]} teslim oldu. ${winner}`;
    case 'agreement':
      return 'Beraberlik kabul edildi.';
    case 'timeout':
      return o.winner ? `Süre bitti. ${winner}` : 'Süre bitti, ama rakibin mat gücü yok — berabere.';
  }
}

/** Short Turkish end reason for the game record. */
const TERMINATION: Record<EndReason, string> = {
  checkmate: 'Mat',
  stalemate: 'Pat',
  'fifty-move': '50 hamle',
  threefold: 'Üç kez tekrar',
  insufficient: 'Yetersiz materyal',
  resign: 'Teslim',
  agreement: 'Anlaşmalı beraberlik',
  timeout: 'Süre',
};

const resultCode = (o: Outcome): ResultCode => (o.winner === 'w' ? '1-0' : o.winner === 'b' ? '0-1' : '1/2-1/2');

interface Timeline {
  readonly states: readonly GameState[];
  readonly cursor: number;
}

/** Pre-game variant questions still to be answered by a human. */
interface PendingSetup {
  readonly questions: readonly SetupQuestion[];
  readonly answers: Readonly<Record<string, string>>;
  readonly step: number;
}

interface Session {
  /** Changes with every new game (stale bot answers are ignored). */
  readonly key: number;
  readonly settings: GameSettings;
  readonly players: Readonly<Record<Color, Player>>;
  readonly timeline: Timeline;
  /** Set when the game ends outside the rules (resignation, agreement, time). */
  readonly outcome: Outcome | null;
  readonly setup: PendingSetup | null;
  /** Base seed for the bots' randomness in this game. */
  readonly seed: number;
  readonly clock: ClockState;
}

const timelineFor = (v: VariantDefinition, answers: Readonly<Record<string, string>> = {}): Timeline => ({
  states: [createGame(v, setupStartPosition(v, answers))],
  cursor: 0,
});

function playersFor(s: GameSettings, humanColor: Color): Record<Color, Player> {
  switch (s.mode) {
    case 'hotseat':
      return { w: { kind: 'human' }, b: { kind: 'human' } };
    case 'bot':
      return humanColor === 'w'
        ? { w: { kind: 'human' }, b: { kind: 'bot', level: s.botLevel } }
        : { w: { kind: 'bot', level: s.botLevel }, b: { kind: 'human' } };
    case 'botvbot':
      return { w: { kind: 'bot', level: s.whiteLevel }, b: { kind: 'bot', level: s.blackLevel } };
  }
}

function newSession(settings: GameSettings, key: number): Session {
  const v = getVariant(settings.variantId);
  const humanColor: Color = settings.humanColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.humanColor;
  const players = playersFor(settings, humanColor);
  // Bots answer their own setup questions at random; humans are asked.
  const answers: Record<string, string> = {};
  const ask: SetupQuestion[] = [];
  const anyHuman = players.w.kind === 'human' || players.b.kind === 'human';
  for (const q of v.setup?.questions ?? []) {
    const botAnswers = q.color ? players[q.color].kind === 'bot' : !anyHuman;
    if (botAnswers) answers[q.id] = q.options[Math.floor(Math.random() * q.options.length)].id;
    else ask.push(q);
  }
  return {
    key,
    settings,
    players,
    timeline: timelineFor(v, answers),
    outcome: null,
    setup: ask.length ? { questions: ask, answers, step: 0 } : null,
    seed: Math.floor(Math.random() * 2 ** 31),
    clock: createClock(timeControl(settings.timeControl)),
  };
}

/** Ends the session outside the rules (resignation, agreement, time) and stops the clock. */
const endSession = (s: Session, outcome: Outcome): Session => ({
  ...s,
  outcome,
  clock: stopClock(s.clock, Date.now()),
});

const botName = (p: Player) => (p.kind === 'bot' ? `${levelConfig(p.level).name} (${p.level})` : 'İnsan');

export function App() {
  const [session, setSession] = useState<Session>(() => newSession(loadSettings(), 1));
  const [showNewGame, setShowNewGame] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<{ game: GameState; arrow: readonly [Square, Square] } | null>(null);
  /** Move queued while the bot thinks; played as soon as it is legal (tied to its game). */
  const [premove, setPremove] = useState<(Premove & { key: number }) | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  /** Bot vs Bot playback: running, paused, or paused after exactly one more move. */
  const [run, setRun] = useState<'play' | 'pause' | 'step'>('play');
  const [showHistory, setShowHistory] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);
  const soundOn = useRef(prefs.sound);
  soundOn.current = prefs.sound;
  const sound = (kind: SoundKind) => {
    if (soundOn.current) playSound(kind);
  };

  // Two workers: one plays, the other answers hints and draw offers without cancelling the bot.
  const botRef = useRef<BotClient | null>(null);
  const helperRef = useRef<BotClient | null>(null);
  const bot = () => (botRef.current ??= new BotClient());
  const helper = () => (helperRef.current ??= new BotClient());
  useEffect(
    () => () => {
      botRef.current?.dispose();
      helperRef.current?.dispose();
    },
    [],
  );

  const { settings, players, timeline, setup } = session;
  const variant = getVariant(settings.variantId);
  const game = timeline.states[timeline.cursor];
  const atEnd = timeline.cursor === timeline.states.length - 1;
  const lastPlayed = game.moves.at(-1)?.move ?? null;
  const outcome: Outcome | null = session.outcome ?? game.result;
  const turn = game.position.turn;
  const toMove = players[turn];
  const vsBot = settings.mode === 'bot';
  const humanColor: Color | null = vsBot ? (players.w.kind === 'human' ? 'w' : 'b') : null;
  const watching = settings.mode === 'botvbot';
  const botTurn =
    toMove.kind === 'bot' &&
    !outcome &&
    !setup &&
    atEnd &&
    !showNewGame &&
    !showRules &&
    !(watching && run === 'pause');

  const startGame = (s: GameSettings) => {
    setPremove(null);
    saveSettings(s);
    botRef.current?.stop();
    helperRef.current?.stop();
    const next = newSession(s, session.key + 1);
    setSession(next);
    setFlipped(next.players.w.kind === 'bot' && next.players.b.kind === 'human');
    setPromotion(null);
    setHint(null);
    setNotice(null);
    setShowNewGame(false);
    setShowRules(!isRuleCardHidden(s.variantId));
    setRun('play');
  };

  const onSetupPick = (optionId: string) => {
    setSession((s) => {
      if (!s.setup) return s;
      const q = s.setup.questions[s.setup.step];
      const answers = { ...s.setup.answers, [q.id]: optionId };
      const step = s.setup.step + 1;
      return {
        ...s,
        // The board previews the choices made so far.
        timeline: timelineFor(getVariant(s.settings.variantId), answers),
        setup: step < s.setup.questions.length ? { ...s.setup, answers, step } : null,
      };
    });
  };

  /** Plays a move at the timeline cursor (later moves are dropped), if the game is still the same. */
  const play = (move: Move, key = session.key) => {
    setSession((s) => {
      if (s.key !== key || s.outcome) return s;
      const { states, cursor } = s.timeline;
      const v = getVariant(s.settings.variantId);
      const now = Date.now();
      const next = makeMove(v, states[cursor], move);
      let clock = pressClock(s.clock, states[cursor].position.turn, now);
      if (next.result) clock = stopClock(clock, now);
      return { ...s, clock, timeline: { states: [...states.slice(0, cursor + 1), next], cursor: cursor + 1 } };
    });
    setHint(null);
    setNotice(null);
    setRun((r) => (r === 'step' ? 'pause' : r));
  };

  // A queued premove is played as soon as it is the human's turn, if it is legal then
  // (promotions become queens, as on lichess); otherwise it is dropped.
  useEffect(() => {
    if (!premove) return;
    if (premove.key !== session.key || outcome || !atEnd) {
      setPremove(null);
      return;
    }
    if (toMove.kind !== 'human' || setup) return;
    setPremove(null);
    const candidates = legalMoves(variant, game.position).filter((m) => m.from === premove.from && m.to === premove.to);
    if (!candidates.length) return;
    const queen = candidates.find((m) => m.promotion === variant.promotionTypes[0]);
    play(queen ?? candidates[0]);
    // Runs when the position changes (the bot has moved) or a premove is queued.
  }, [game, premove]);

  // The bot moves whenever it is its turn at the end of the timeline.
  const thinkToken = useRef(0);
  useEffect(() => {
    if (!botTurn || toMove.kind !== 'bot') return;
    const token = ++thinkToken.current;
    const key = session.key;
    setThinking(true);
    bot()
      .think({
        variantId: variant.id,
        state: game,
        level: toMove.level,
        seed: session.seed + game.moves.length,
        timeLimitMs: isTimed(session.clock)
          ? botTimeMs(toMove.level, {
              remainingMs: remainingMs(session.clock, turn, Date.now()),
              incrementMs: session.clock.control.incrementMs,
            })
          : undefined,
        minThinkMs: settings.mode === 'botvbot' ? settings.delayMs : undefined,
      })
      .then((r) => play(r.move, key))
      .catch((e) => {
        if (!(e instanceof BotCancelled)) setNotice(`Bot hatası: ${e instanceof Error ? e.message : e}`);
      })
      .finally(() => {
        if (thinkToken.current === token) setThinking(false);
      });
    return () => {
      thinkToken.current++;
      setThinking(false);
      botRef.current?.stop();
    };
    // `game` identity changes with every move; the rest only with a new game.
  }, [session.key, game, botTurn]);

  // Sounds for new moves (not for undo or browsing).
  const endState = timeline.states[timeline.states.length - 1];
  const seenLength = useRef({ key: session.key, length: timeline.states.length });
  useEffect(() => {
    const prev = seenLength.current;
    seenLength.current = { key: session.key, length: timeline.states.length };
    if (prev.key !== session.key || timeline.states.length <= prev.length) return;
    const last = endState.moves.at(-1)?.move;
    if (endState.result) return; // the end sound plays instead
    if (isInCheck(variant, endState.position)) sound('check');
    else sound(last?.captured !== undefined ? 'capture' : 'move');
  }, [session.key, timeline.states.length]);

  // Game over: end sound once, and the game goes into the history.
  const finalOutcome: Outcome | null = session.outcome ?? endState.result;
  const recorded = useRef(0);
  useEffect(() => {
    if (!finalOutcome || recorded.current === session.key) return;
    recorded.current = session.key;
    sound('end');
    if (endState.moves.length === 0) return;
    const desc = (p: Player) => (p.kind === 'bot' ? botName(p) : 'İnsan');
    storeGame({
      id: newGameId(),
      date: new Date().toISOString(),
      variantId: variant.id,
      mode: MODE_NAMES[settings.mode],
      white: desc(players.w),
      black: desc(players.b),
      result: resultCode(finalOutcome),
      termination: TERMINATION[finalOutcome.reason],
      startFen: toFen(variant, timeline.states[0].position),
      moves: endState.moves.map((m) => m.san),
    });
  }, [finalOutcome, session.key]);

  // Clock: warn once when a human's time drops under 10 seconds.
  const lowWarned = useRef(new Set<string>());

  // Clock: end the game when a flag falls (the clock displays tick on their own).
  const clockRunning = session.clock.running !== null && !outcome;
  useEffect(() => {
    if (!clockRunning) return;
    const id = setInterval(() => {
      const c = session.clock;
      const side = c.running;
      const warnKey = `${session.key}:${side}`;
      if (side && players[side].kind === 'human' && !lowWarned.current.has(warnKey)) {
        const left = remainingMs(c, side, Date.now());
        if (left < LOW_TIME_MS && left > 0) {
          lowWarned.current.add(warnKey);
          sound('lowtime');
        }
      }
      setSession((s) => {
        const loser = flagged(s.clock, Date.now());
        if (!loser || s.outcome) return s;
        const v = getVariant(s.settings.variantId);
        const pos = s.timeline.states[s.timeline.states.length - 1].position;
        return endSession(s, { reason: 'timeout', winner: timeoutWinner(v, pos, loser) });
      });
    }, 100);
    return () => clearInterval(id);
  }, [clockRunning, session.key, session.clock]);

  const onMove = (candidates: Move[]) => {
    if (candidates.length > 1) setPromotion(candidates);
    else play(candidates[0]);
  };

  const onPromote = (type: PieceType) => {
    const move = promotion?.find((m) => m.promotion === type);
    setPromotion(null);
    if (move) play(move);
  };

  /** Against the bot: take back the last own move together with the bot's answer. */
  const undoPair = () => {
    setPremove(null);
    botRef.current?.stop();
    setSession((s) => {
      const states = s.timeline.states;
      let i = states.length - 2;
      while (i > 0 && s.players[states[i].position.turn].kind !== 'human') i--;
      if (i < 0 || s.players[states[i].position.turn].kind !== 'human') return s;
      const kept = states.slice(0, i + 1);
      return { ...s, outcome: null, timeline: { states: kept, cursor: kept.length - 1 } };
    });
    setHint(null);
    setNotice(null);
  };

  const askHint = () => {
    setHintBusy(true);
    helper()
      .think({ variantId: variant.id, state: game, level: HINT.level, timeLimitMs: HINT.timeLimitMs, minThinkMs: 0 })
      .then((r) => setHint({ game, arrow: [r.move.from, r.move.to] }))
      .catch(() => {})
      .finally(() => setHintBusy(false));
  };

  const offerDraw = () => {
    const botColor = humanColor ? opposite(humanColor) : null;
    const botPlayer = botColor ? players[botColor] : null;
    if (!botColor || botPlayer?.kind !== 'bot') return;
    const key = session.key;
    if (botPlayer.level < 3) {
      setNotice('Bot beraberliği reddetti.');
      return;
    }
    setNotice('Bot teklifi değerlendiriyor…');
    helper()
      .think({ variantId: variant.id, state: game, level: botPlayer.level, timeLimitMs: 500 })
      .then((r) => {
        const botScore = turn === botColor ? r.score : -r.score;
        if (acceptsDraw(botPlayer.level, botScore)) {
          botRef.current?.stop();
          setSession((s) => (s.key === key ? endSession(s, { reason: 'agreement', winner: null }) : s));
          setNotice(null);
        } else {
          setNotice('Bot beraberliği reddetti.');
        }
      })
      .catch(() => setNotice(null));
  };

  const resign = () => {
    const loser = humanColor ?? turn;
    botRef.current?.stop();
    setSession((s) => endSession(s, { reason: 'resign', winner: opposite(loser) }));
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

  const goTo = (cursor: number) =>
    setSession((s) => ({
      ...s,
      timeline: { ...s.timeline, cursor: Math.max(0, Math.min(s.timeline.states.length - 1, cursor)) },
    }));

  const timed = isTimed(session.clock);
  const humanToMove = toMove.kind === 'human';
  const boardDisabled =
    !!outcome || promotion !== null || setup !== null || !humanToMove || (!atEnd && (vsBot || timed));
  // Premoves: against the bot, while it is the bot's turn and the game is on.
  const premoveColor: Color | null =
    vsBot && humanColor && !humanToMove && !outcome && !setup && atEnd && promotion === null ? humanColor : null;
  // With a clock, taking back moves and hints are off.
  const canUndoPair = vsBot && !timed && timeline.states.length > 1;

  let status: string;
  if (outcome) status = outcomeText(outcome);
  else if (setup) status = 'Oyun öncesi seçim bekleniyor…';
  else if (thinking) status = `${COLOR_NAME[turn]} bot (${botName(toMove)}) düşünüyor…`;
  else if (watching && run === 'pause') status = `Duraklatıldı — sıra: ${COLOR_NAME[turn]}`;
  else status = `Sıra: ${COLOR_NAME[turn]}${isInCheck(variant, game.position) ? ' — Şah!' : ''}`;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>dorkchess</h1>
        <span className="muted game-label">
          {variant.name} · {settings.mode === 'hotseat' ? 'İki kişi' : `${botName(players.w)} – ${botName(players.b)}`}
        </span>
        <button onClick={() => setShowRules(true)}>Kurallar</button>
        <button onClick={() => setShowHistory(true)}>Geçmiş</button>
        <label className="pref">
          Tema{' '}
          <select
            value={prefs.boardTheme}
            onChange={(e) => setPrefs((p) => ({ ...p, boardTheme: e.target.value as BoardTheme }))}
          >
            {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((t) => (
              <option key={t} value={t}>
                {BOARD_THEMES[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="pref">
          Arayüz{' '}
          <select value={prefs.ui} onChange={(e) => setPrefs((p) => ({ ...p, ui: e.target.value as UiMode }))}>
            {(Object.keys(UI_MODES) as UiMode[]).map((m) => (
              <option key={m} value={m}>
                {UI_MODES[m]}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
          aria-pressed={prefs.sound}
          title={prefs.sound ? 'Sesi kapat' : 'Sesi aç'}
        >
          {prefs.sound ? '🔊 Ses' : '🔇 Sessiz'}
        </button>
        <button onClick={() => setShowNewGame(true)}>Yeni oyun</button>
      </header>

      <main className="layout">
        <section className="board-wrap">
          {timed && <ClockView clock={session.clock} color={flipped ? 'w' : 'b'} players={players} />}
          <div className="board-area">
            <Board
              variant={variant}
              position={game.position}
              lastMove={lastPlayed}
              flipped={flipped}
              highlight={showHighlight && variant.highlight ? variant.highlight.squares(game.position) : []}
              bandRanks={variant.highlight?.ranks ?? []}
              arrows={hint && hint.game === game ? [hint.arrow] : []}
              disabled={boardDisabled}
              premoveColor={premoveColor}
              premove={premove && premove.key === session.key ? premove : null}
              onPremove={(p) => setPremove({ ...p, key: session.key })}
              onCancelPremove={() => setPremove(null)}
              onMove={onMove}
            />
            {setup && (
              <SetupDialog
                variant={variant}
                question={setup.questions[setup.step]}
                step={setup.step}
                total={setup.questions.length}
                onPick={onSetupPick}
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
          <div className="controls">
            {vsBot ? (
              <button onClick={undoPair} disabled={!canUndoPair} title="Son hamleni ve botun cevabını geri al">
                ↶ Geri al
              </button>
            ) : (
              <>
                <button onClick={() => goTo(timeline.cursor - 1)} disabled={timeline.cursor === 0} title="Geri">
                  ◀ Geri
                </button>
                <button onClick={() => goTo(timeline.cursor + 1)} disabled={atEnd} title="İleri">
                  İleri ▶
                </button>
              </>
            )}
            {vsBot && (
              <button onClick={askHint} disabled={timed || !humanToMove || !!outcome || hintBusy || !!setup}>
                {hintBusy ? 'İpucu…' : 'İpucu'}
              </button>
            )}
            {vsBot && (
              <button onClick={offerDraw} disabled={!!outcome || !!setup}>
                Beraberlik teklif et
              </button>
            )}
            {settings.mode !== 'botvbot' && (
              <button onClick={resign} disabled={!!outcome || !!setup}>
                Teslim ol
              </button>
            )}
            {watching && (
              <>
                <button onClick={() => setRun((r) => (r === 'play' ? 'pause' : 'play'))} disabled={!!outcome}>
                  {run === 'play' ? '❚❚ Duraklat' : '▶ Devam'}
                </button>
                <button onClick={() => setRun('step')} disabled={run !== 'pause' || !!outcome || !atEnd}>
                  Adım ▶|
                </button>
              </>
            )}
            <button onClick={() => setFlipped((f) => !f)}>Tahtayı çevir</button>
            {variant.highlight && (
              <button onClick={() => setShowHighlight((h) => !h)} aria-pressed={showHighlight}>
                {variant.highlight.label}: {showHighlight ? 'açık' : 'kapalı'}
              </button>
            )}
            <button onClick={copyFen}>{copied ? 'Kopyalandı ✓' : 'Konumu kopyala'}</button>
          </div>
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
            <MoveList game={timeline.states.at(-1)!} cursor={timeline.cursor} onSelect={vsBot ? () => {} : goTo} />
          </div>
          <div className="panel">
            <h2>Konum</h2>
            <code className="fen">{fen}</code>
          </div>
        </aside>
      </main>

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
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
