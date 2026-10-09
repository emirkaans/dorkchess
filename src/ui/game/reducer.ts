// All game-state changes as one pure reducer (no React, no timers: the current
// time comes in with the actions that need it), so they can be unit-tested.

import { flagged, pressClock, stopClock, timeoutWinner } from '../../clock/clock.ts';
import { getVariant, legalMoves, makeMove } from '../../engine/index.ts';
import type { Move } from '../../engine/index.ts';
import { endSession, timelineFor } from './session.ts';
import type { GameSession, Outcome, Premove, Run } from './session.ts';

export type GameAction =
  /** Replaces the session with a new game (built by newSession). */
  | { readonly type: 'start'; readonly session: GameSession }
  /** Answer to the current pre-game setup question. */
  | { readonly type: 'setupAnswer'; readonly optionId: string }
  /** Plays `move` at the timeline cursor (later moves are dropped), if `key` is still the current game. */
  | { readonly type: 'move'; readonly move: Move; readonly key: number; readonly now: number }
  /** Against the bot: takes back the last own move together with the bot's answer. */
  | { readonly type: 'undoPair' }
  /** Moves the timeline cursor (browsing). */
  | { readonly type: 'goTo'; readonly cursor: number }
  /** Ends the game outside the rules (resignation, agreed draw). */
  | { readonly type: 'end'; readonly outcome: Outcome; readonly key: number; readonly now: number }
  /** Clock check: a fallen flag ends the game. */
  | { readonly type: 'tick'; readonly now: number }
  /** Queues (or with null cancels) a premove. */
  | { readonly type: 'premove'; readonly premove: Premove | null }
  /** Bot vs Bot playback control. */
  | { readonly type: 'run'; readonly run: Run };

/** Plays one move at the cursor (clock pressed, stopped if the game ends). */
function playMove(s: GameSession, move: Move, now: number): GameSession {
  const { states, cursor } = s.timeline;
  const v = getVariant(s.settings.variantId);
  const next = makeMove(v, states[cursor], move);
  let clock = pressClock(s.clock, states[cursor].position.turn, now);
  if (next.result) clock = stopClock(clock, now);
  return { ...s, clock, timeline: { states: [...states.slice(0, cursor + 1), next], cursor: cursor + 1 } };
}

/**
 * After a move: if a premove is queued and it is now the human's turn, it is
 * played when legal (promotions become queens, as on lichess) and dropped otherwise.
 */
function runPremove(s: GameSession, now: number): GameSession {
  const p = s.premove;
  if (!p) return s;
  const game = s.timeline.states[s.timeline.cursor];
  if (s.players[game.position.turn].kind !== 'human') return s;
  const cleared = { ...s, premove: null };
  if (game.result || s.outcome) return cleared;
  const v = getVariant(s.settings.variantId);
  const candidates = legalMoves(v, game.position).filter((m) => m.from === p.from && m.to === p.to);
  if (!candidates.length) return cleared;
  const queen = candidates.find((m) => m.promotion === v.promotionTypes[0]);
  return playMove(cleared, queen ?? candidates[0], now);
}

export function gameReducer(s: GameSession, a: GameAction): GameSession {
  switch (a.type) {
    case 'start':
      return a.session;

    case 'setupAnswer': {
      if (!s.setup) return s;
      const q = s.setup.questions[s.setup.step];
      const answers = { ...s.setup.answers, [q.id]: a.optionId };
      const step = s.setup.step + 1;
      return {
        ...s,
        // The board previews the choices made so far.
        timeline: timelineFor(getVariant(s.settings.variantId), answers),
        setup: step < s.setup.questions.length ? { ...s.setup, answers, step } : null,
      };
    }

    case 'move': {
      if (a.key !== s.key || s.outcome) return s;
      const played = playMove(s, a.move, a.now);
      return runPremove({ ...played, run: s.run === 'step' ? 'pause' : s.run }, a.now);
    }

    case 'undoPair': {
      const states = s.timeline.states;
      let i = states.length - 2;
      while (i > 0 && s.players[states[i].position.turn].kind !== 'human') i--;
      if (i < 0 || s.players[states[i].position.turn].kind !== 'human') return { ...s, premove: null };
      const kept = states.slice(0, i + 1);
      return { ...s, outcome: null, premove: null, timeline: { states: kept, cursor: kept.length - 1 } };
    }

    case 'goTo': {
      const cursor = Math.max(0, Math.min(s.timeline.states.length - 1, a.cursor));
      return cursor === s.timeline.cursor ? s : { ...s, premove: null, timeline: { ...s.timeline, cursor } };
    }

    case 'end':
      return a.key !== s.key || s.outcome ? s : endSession(s, a.outcome, a.now);

    case 'tick': {
      const loser = flagged(s.clock, a.now);
      if (!loser || s.outcome) return s;
      const v = getVariant(s.settings.variantId);
      const pos = s.timeline.states[s.timeline.states.length - 1].position;
      return endSession(s, { reason: 'timeout', winner: timeoutWinner(v, pos, loser) }, a.now);
    }

    case 'premove':
      return s.premove === a.premove ? s : { ...s, premove: a.premove };

    case 'run':
      return s.run === a.run ? s : { ...s, run: a.run };
  }
}
