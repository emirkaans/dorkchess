// React side of the game: the reducer plus the effects around it (bot worker,
// clock ticks, sounds, game records, hints and draw offers). Each effect reads
// the latest session through a ref and depends only on what should re-run it.

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { BotCancelled, BotClient } from '../../ai/client.ts';
import { HINT, acceptsDraw, botTimeMs } from '../../ai/levels.ts';
import { LOW_TIME_MS, remainingMs } from '../../clock/clock.ts';
import { isInCheck, opposite, toFen } from '../../engine/index.ts';
import type { GameState, Square } from '../../engine/index.ts';
import { storeGame } from '../../storage/games.ts';
import { FLUSH_UPLOAD, uploadRecord, useWatcherCount } from '../online/connection.ts';
import { moveSound } from '../sound.ts';
import type { SoundKind } from '../sound.ts';
import { gameReducer } from './reducer.ts';
import type { GameAction } from './reducer.ts';
import { useI18n } from '../i18n.tsx';
import { playerCode, resultCode, viewOf } from './session.ts';
import type { GameSession, SessionView } from './session.ts';

/** Keeps a ref pointing at the latest value (for effects that must not re-run on every change). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useGame(init: () => GameSession) {
  const [session, dispatch] = useReducer(gameReducer, undefined, init);
  const view = useMemo(() => viewOf(session), [session]);
  return { session, view, dispatch };
}

/** Two workers: one plays, the other answers hints and draw offers without cancelling the bot. */
export function useBotClients() {
  const [clients] = useState(() => ({ bot: new BotClient(), helper: new BotClient() }));
  useEffect(
    () => () => {
      clients.bot.dispose();
      clients.helper.dispose();
    },
    [clients],
  );
  return clients;
}

/**
 * The bot moves whenever it is its turn at the end of the timeline and
 * `paused` is false. Returns whether it is thinking.
 */
export function useBotPlayer(
  session: GameSession,
  view: SessionView,
  dispatch: Dispatch<GameAction>,
  bot: BotClient,
  paused: boolean,
  onError: (message: string) => void,
): boolean {
  const [thinking, setThinking] = useState(false);
  const { t } = useI18n();
  const latest = useLatest({ session, view, onError, t });
  const botTurn =
    view.toMove.kind === 'bot' &&
    !view.outcome &&
    !session.setup &&
    view.atEnd &&
    !paused &&
    !(view.watching && session.run === 'pause');
  const game = view.game;
  const key = session.key;

  useEffect(() => {
    if (!botTurn) return;
    const { session: s, view: v } = latest.current;
    const player = v.toMove;
    if (player.kind !== 'bot') return;
    let active = true;
    setThinking(true);
    bot
      .think({
        variantId: v.variant.id,
        state: game,
        level: player.level,
        seed: s.seed + game.moves.length,
        timeLimitMs: v.timed
          ? botTimeMs(player.level, {
              remainingMs: remainingMs(s.clock, v.turn, Date.now()),
              incrementMs: s.clock.control.incrementMs,
            })
          : undefined,
        minThinkMs: s.settings.mode === 'botvbot' ? s.settings.delayMs : undefined,
      })
      .then((r) => dispatch({ type: 'move', move: r.move, key, now: Date.now() }))
      .catch((e) => {
        if (!(e instanceof BotCancelled)) {
          const { onError: report, t: tr } = latest.current;
          report(tr('notice.botError', { message: e instanceof Error ? e.message : String(e) }));
        }
      })
      .finally(() => {
        if (active) setThinking(false);
      });
    return () => {
      active = false;
      setThinking(false);
      bot.stop();
    };
  }, [botTurn, game, key, bot, dispatch, latest]);

  return thinking;
}

/** Ends the game when a flag falls and warns once when a human's time drops under 10 seconds. */
export function useClockTicker(
  session: GameSession,
  view: SessionView,
  dispatch: Dispatch<GameAction>,
  sound: (k: SoundKind) => void,
): void {
  const latest = useLatest({ session, sound });
  const warned = useRef(new Set<string>());
  const running = session.clock.running !== null && !view.outcome;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { session: s, sound: play } = latest.current;
      const side = s.clock.running;
      const warnKey = `${s.key}:${side}`;
      if (side && s.players[side].kind === 'human' && !warned.current.has(warnKey)) {
        const left = remainingMs(s.clock, side, Date.now());
        if (left < LOW_TIME_MS && left > 0) {
          warned.current.add(warnKey);
          play('lowtime');
        }
      }
      dispatch({ type: 'tick', now: Date.now() });
    }, 100);
    return () => clearInterval(id);
  }, [running, dispatch, latest]);
}

/** Sounds for new moves (not for undo or browsing); at game end the end sound and the history record. */
export function useGameFeedback(session: GameSession, view: SessionView, sound: (k: SoundKind) => void): void {
  const latest = useLatest({ session, view, sound });
  const length = session.timeline.states.length;
  const key = session.key;
  const seen = useRef({ key, length });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { key, length };
    if (prev.key !== key || length <= prev.length) return;
    const { view: v, sound: play } = latest.current;
    const end = v.endState;
    if (end.result) return; // the end sound plays instead
    play(moveSound(end.moves.at(-1)?.move.captured !== undefined, isInCheck(v.variant, end.position)));
  }, [key, length, latest]);

  const finalOutcome = view.finalOutcome;
  const recorded = useRef(0);
  useEffect(() => {
    if (!finalOutcome) return;
    const { session: s, view: v, sound: play } = latest.current;
    // Every ending sounds, also one reached again after a take-back; the game is stored once.
    play(finalOutcome.reason === 'checkmate' ? 'mate' : 'end');
    if (recorded.current === key) return;
    recorded.current = key;
    if (v.endState.moves.length === 0) return;
    storeGame({
      id: s.gameId,
      date: new Date().toISOString(),
      variantId: v.variant.id,
      mode: s.settings.mode,
      white: playerCode(s.players.w),
      black: playerCode(s.players.b),
      result: resultCode(finalOutcome),
      termination: finalOutcome.reason,
      startFen: toFen(v.variant, s.timeline.states[0].position),
      moves: v.endState.moves.map((m) => m.san),
    });
  }, [finalOutcome, key, latest]);
}

/** Plies between uploads of a game nobody follows. */
const UPLOAD_EVERY = 8;

/**
 * Keeps the server copy of a local game (its link /<gameId> works for anyone)
 * fresh without a request per move: it is uploaded at the first move, every
 * few moves, when the game ends, when its link is shared and when the page is
 * hidden or closed. While someone follows the game live, after every move.
 */
export function useGameUpload(session: GameSession, view: SessionView): void {
  const latest = useLatest({ session, view });
  const length = view.endState.moves.length;
  const outcome = view.finalOutcome;
  const gameId = session.gameId;
  // What the server has (moves and whether it ended) and whether anyone watches.
  const sent = useRef({ gameId: '', length: 0, over: false, watchers: 0 });
  // Once the game is on the server, the server tells when people follow it.
  const [stored, setStored] = useState<string | null>(null);

  const upload = useRef((keepalive = false) => {
    const { session: s, view: v } = latest.current;
    const moves = v.endState.moves;
    const over = !!v.finalOutcome;
    const last = sent.current;
    if (moves.length === 0) return;
    if (last.gameId === s.gameId && last.length === moves.length && last.over === over) return;
    sent.current = {
      gameId: s.gameId,
      length: moves.length,
      over,
      watchers: last.gameId === s.gameId ? last.watchers : 0,
    };
    void uploadRecord(
      s.gameId,
      {
        variantId: v.variant.id,
        startFen: toFen(v.variant, s.timeline.states[0].position),
        moves: moves.map((m) => m.san),
        white: playerCode(s.players.w),
        black: playerCode(s.players.b),
        mode: s.settings.mode,
        timeControlId: s.settings.timeControl,
        result: v.finalOutcome ? resultCode(v.finalOutcome) : '*',
        termination: v.finalOutcome?.reason ?? '',
        date: new Date().toISOString(),
      },
      keepalive,
    ).then((watchers) => {
      if (watchers === null || sent.current.gameId !== s.gameId) return;
      sent.current = { ...sent.current, watchers };
      setStored(s.gameId);
    });
  });
  useWatcherCount(stored === gameId ? gameId : null, (count) => {
    sent.current = { ...sent.current, watchers: count };
    // Someone just started following: bring the server copy up to date now.
    if (count > 0) upload.current();
  });

  useEffect(() => {
    if (length === 0) return;
    const last = sent.current;
    const fresh = last.gameId !== gameId;
    const due = fresh || !!outcome || last.watchers > 0 || length - last.length >= UPLOAD_EVERY || length < last.length;
    if (!due) return;
    const timer = setTimeout(() => upload.current(), 1000);
    return () => clearTimeout(timer);
  }, [gameId, length, outcome]);

  useEffect(() => {
    const flush = () => upload.current();
    const hidden = () => {
      if (document.visibilityState === 'hidden') upload.current(true);
    };
    const leave = () => upload.current(true);
    window.addEventListener(FLUSH_UPLOAD, flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener(FLUSH_UPLOAD, flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
    };
  }, []);
}

/** Hint (level 4 search, shown as an arrow) and draw offers against the bot. */
export function useAssistant(
  session: GameSession,
  view: SessionView,
  dispatch: Dispatch<GameAction>,
  clients: { bot: BotClient; helper: BotClient },
  setNotice: (n: string | null) => void,
) {
  const [hint, setHint] = useState<{ game: GameState; arrow: readonly [Square, Square] } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const { t } = useI18n();

  const askHint = () => {
    const game = view.game;
    setHintBusy(true);
    clients.helper
      .think({
        variantId: view.variant.id,
        state: game,
        level: HINT.level,
        timeLimitMs: HINT.timeLimitMs,
        minThinkMs: 0,
      })
      .then((r) => setHint({ game, arrow: [r.move.from, r.move.to] }))
      .catch(() => {})
      .finally(() => setHintBusy(false));
  };

  const offerDraw = () => {
    const botColor = view.humanColor ? opposite(view.humanColor) : null;
    const botPlayer = botColor ? session.players[botColor] : null;
    if (!botColor || botPlayer?.kind !== 'bot') return;
    const key = session.key;
    if (botPlayer.level < 3) {
      setNotice(t('notice.drawDeclined'));
      return;
    }
    setNotice(t('notice.drawThinking'));
    const turn = view.turn;
    clients.helper
      .think({ variantId: view.variant.id, state: view.game, level: botPlayer.level, timeLimitMs: 500 })
      .then((r) => {
        const botScore = turn === botColor ? r.score : -r.score;
        if (acceptsDraw(botPlayer.level, botScore)) {
          clients.bot.stop();
          dispatch({ type: 'end', outcome: { reason: 'agreement', winner: null }, key, now: Date.now() });
          setNotice(null);
        } else {
          setNotice(t('notice.drawDeclined'));
        }
      })
      .catch(() => setNotice(null));
  };

  // A hint belongs to the position it was computed for.
  const hintArrow = hint && hint.game === view.game ? hint.arrow : null;
  return { hintArrow, hintBusy, askHint, offerDraw, clearHint: () => setHint(null) };
}
