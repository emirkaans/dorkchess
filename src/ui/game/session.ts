// Game session model: who plays, the timeline of positions, setup questions,
// clock, premove and how the game ended. Pure TypeScript (no React), so the
// reducer and everything derived from it can be unit-tested.

import { levelConfig } from '../../ai/levels.ts';
import { createClock, isTimed, stopClock, timeControl } from '../../clock/clock.ts';
import type { ClockState } from '../../clock/clock.ts';
import { createGame, getVariant, opposite, setupStartPosition } from '../../engine/index.ts';
import type { Color, GameEndReason, GameState, SetupQuestion, Square, VariantDefinition } from '../../engine/index.ts';
import type { ResultCode } from '../../storage/games.ts';
import type { GameSettings } from '../settings.ts';

export const COLOR_NAME = { w: 'Beyaz', b: 'Siyah' } as const;

export type Player = { readonly kind: 'human' } | { readonly kind: 'bot'; readonly level: number };

/** How a game ended: the engine's reasons plus the ones decided outside the rules. */
export type EndReason = GameEndReason | 'resign' | 'agreement' | 'timeout';

export interface Outcome {
  readonly reason: EndReason;
  readonly winner: Color | null;
}

export interface Timeline {
  readonly states: readonly GameState[];
  readonly cursor: number;
}

/** Pre-game variant questions still to be answered by a human. */
export interface PendingSetup {
  readonly questions: readonly SetupQuestion[];
  readonly answers: Readonly<Record<string, string>>;
  readonly step: number;
}

/** A move queued while the bot thinks. */
export interface Premove {
  readonly from: Square;
  readonly to: Square;
}

/** Bot vs Bot playback: running, paused, or paused after exactly one more move. */
export type Run = 'play' | 'pause' | 'step';

export interface GameSession {
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
  readonly premove: Premove | null;
  readonly run: Run;
}

export function timelineFor(v: VariantDefinition, answers: Readonly<Record<string, string>> = {}): Timeline {
  return { states: [createGame(v, setupStartPosition(v, answers))], cursor: 0 };
}

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

/**
 * A new game; `random` (default Math.random) decides a random colour, bots'
 * setup answers and the seed. With `startFen` the game starts from that
 * position (e.g. a shared link) and no setup questions are asked.
 */
export function newSession(
  settings: GameSettings,
  key: number,
  random: () => number = Math.random,
  startFen?: string,
): GameSession {
  const v = getVariant(settings.variantId);
  const humanColor: Color = settings.humanColor === 'random' ? (random() < 0.5 ? 'w' : 'b') : settings.humanColor;
  const players = playersFor(settings, humanColor);
  // Bots answer their own setup questions at random; humans are asked.
  const answers: Record<string, string> = {};
  const ask: SetupQuestion[] = [];
  const anyHuman = players.w.kind === 'human' || players.b.kind === 'human';
  for (const q of startFen ? [] : (v.setup?.questions ?? [])) {
    const botAnswers = q.color ? players[q.color].kind === 'bot' : !anyHuman;
    if (botAnswers) answers[q.id] = q.options[Math.floor(random() * q.options.length)].id;
    else ask.push(q);
  }
  return {
    key,
    settings,
    players,
    timeline: startFen ? { states: [createGame(v, startFen)], cursor: 0 } : timelineFor(v, answers),
    outcome: null,
    setup: ask.length ? { questions: ask, answers, step: 0 } : null,
    seed: Math.floor(random() * 2 ** 31),
    clock: createClock(timeControl(settings.timeControl)),
    premove: null,
    run: 'play',
  };
}

/** Ends the session outside the rules (resignation, agreement, time) and stops the clock. */
export function endSession(s: GameSession, outcome: Outcome, now: number): GameSession {
  return { ...s, outcome, clock: stopClock(s.clock, now), premove: null };
}

/** Everything the UI derives from a session. */
export interface SessionView {
  readonly variant: VariantDefinition;
  /** Position shown (at the timeline cursor). */
  readonly game: GameState;
  /** Latest position of the game. */
  readonly endState: GameState;
  readonly atEnd: boolean;
  /** Outcome of the shown position (rules or resignation / agreement / time). */
  readonly outcome: Outcome | null;
  /** Outcome of the game as a whole. */
  readonly finalOutcome: Outcome | null;
  readonly turn: Color;
  readonly toMove: Player;
  readonly vsBot: boolean;
  readonly watching: boolean;
  /** The human's colour against the bot, else null. */
  readonly humanColor: Color | null;
  readonly timed: boolean;
}

export function viewOf(s: GameSession): SessionView {
  const variant = getVariant(s.settings.variantId);
  const game = s.timeline.states[s.timeline.cursor];
  const endState = s.timeline.states[s.timeline.states.length - 1];
  const vsBot = s.settings.mode === 'bot';
  return {
    variant,
    game,
    endState,
    atEnd: s.timeline.cursor === s.timeline.states.length - 1,
    outcome: s.outcome ?? game.result,
    finalOutcome: s.outcome ?? endState.result,
    turn: game.position.turn,
    toMove: s.players[game.position.turn],
    vsBot,
    watching: s.settings.mode === 'botvbot',
    humanColor: vsBot ? (s.players.w.kind === 'human' ? 'w' : 'b') : null,
    timed: isTimed(s.clock),
  };
}

export const botName = (p: Player) => (p.kind === 'bot' ? `${levelConfig(p.level).name} (${p.level})` : 'İnsan');

export function outcomeText(o: Outcome): string {
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
export const TERMINATION: Record<EndReason, string> = {
  checkmate: 'Mat',
  stalemate: 'Pat',
  'fifty-move': '50 hamle',
  threefold: 'Üç kez tekrar',
  insufficient: 'Yetersiz materyal',
  resign: 'Teslim',
  agreement: 'Anlaşmalı beraberlik',
  timeout: 'Süre',
};

export const resultCode = (o: Outcome): ResultCode => (o.winner === 'w' ? '1-0' : o.winner === 'b' ? '0-1' : '1/2-1/2');
