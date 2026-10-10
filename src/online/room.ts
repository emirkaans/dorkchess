// Rules of one online game, independent of how it is stored or connected:
// seats, setup answers, moves, clock, draw offers, resignation and the
// disconnect rule. Pure: the caller passes the time (`now`) and randomness.
// The Durable Object in server/ persists a Room and calls these functions.

import {
  createClock,
  flagged,
  pressClock,
  remainingMs,
  stopClock,
  timeControl,
  timeoutWinner,
} from '../clock/clock.ts';
import type { ClockState } from '../clock/clock.ts';
import {
  createGame,
  findMove,
  getVariant,
  listVariants,
  makeMove,
  opposite,
  setupStartPosition,
} from '../engine/index.ts';
import type { Color, GameState, SetupQuestion, VariantDefinition } from '../engine/index.ts';
import { MAX_NAME, RECONNECT_MS } from './protocol.ts';
import type { CreateRequest, ErrorCode, GameView, OnlineOutcome, Phase, WireMove } from './protocol.ts';

export interface Seat {
  readonly name: string;
  readonly token: string;
}

export interface Room {
  readonly id: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly seats: Readonly<Record<Color, Seat | null>>;
  readonly phase: Phase;
  /** Setup answers (question id -> option id), complete once the game starts. */
  readonly answers: Readonly<Record<string, string>>;
  readonly startFen: string | null;
  readonly moves: readonly WireMove[];
  readonly clock: ClockState;
  readonly outcome: OnlineOutcome | null;
  readonly drawOffer: Color | null;
  /** Deadline per disconnected player (playing phase only). */
  readonly gone: Readonly<Partial<Record<Color, number>>>;
}

export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

const fail = (code: ErrorCode): never => {
  throw new RoomError(code);
};

/** Trimmed, length-limited player name ('' becomes a default chosen by the client). */
export const cleanName = (name: unknown): string =>
  typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';

/** Who answers a setup question: its colour, or White for questions tied to no side. */
const answerer = (q: SetupQuestion): Color => q.color ?? 'w';

export function setupQuestions(v: VariantDefinition): readonly SetupQuestion[] {
  return v.setup?.questions ?? [];
}

export function createRoom(
  id: string,
  req: CreateRequest,
  token: string,
  random: () => number,
): { room: Room; color: Color } {
  if (!listVariants().some((v) => v.id === req.variantId)) fail('bad-request');
  const control = timeControl(req.timeControlId);
  if (control.id !== req.timeControlId) fail('bad-request');
  const color: Color = req.color === 'w' || req.color === 'b' ? req.color : random() < 0.5 ? 'w' : 'b';
  const seat = { name: cleanName(req.name), token };
  const room: Room = {
    id,
    variantId: req.variantId,
    timeControlId: control.id,
    seats: { w: color === 'w' ? seat : null, b: color === 'b' ? seat : null },
    phase: 'waiting',
    answers: {},
    startFen: null,
    moves: [],
    clock: createClock(control),
    outcome: null,
    drawOffer: null,
    gone: {},
  };
  return { room, color };
}

/** The game begins once all setup answers are in. */
function start(room: Room): Room {
  const v = getVariant(room.variantId);
  return { ...room, phase: 'playing', startFen: setupStartPosition(v, room.answers) };
}

/** The second player takes the free seat; without setup questions the game starts right away. */
export function joinRoom(room: Room, name: string, token: string): { room: Room; color: Color } {
  if (room.phase !== 'waiting') fail('full');
  const color: Color | null = room.seats.w === null ? 'w' : room.seats.b === null ? 'b' : null;
  if (!color) return fail('full');
  const joined: Room = { ...room, seats: { ...room.seats, [color]: { name: cleanName(name), token } } };
  const hasSetup = setupQuestions(getVariant(room.variantId)).length > 0;
  return { room: hasSetup ? { ...joined, phase: 'setup' } : start(joined), color };
}

/** Seat colour of a token, or null (spectator). */
export function seatOf(room: Room, token: string | null): Color | null {
  if (!token) return null;
  if (room.seats.w?.token === token) return 'w';
  if (room.seats.b?.token === token) return 'b';
  return null;
}

/** `color` answers its setup questions (all at once); the game starts when every answer is in. */
export function answerSetup(room: Room, color: Color, answers: Readonly<Record<string, string>>): Room {
  if (room.phase !== 'setup') fail('bad-request');
  const mine = setupQuestions(getVariant(room.variantId)).filter((q) => answerer(q) === color);
  const next: Record<string, string> = { ...room.answers };
  for (const q of mine) {
    const a = answers[q.id];
    if (!q.options.some((o) => o.id === a)) fail('bad-request');
    next[q.id] = a;
  }
  const done = setupQuestions(getVariant(room.variantId)).every((q) => q.id in next);
  const updated = { ...room, answers: next };
  return done ? start(updated) : updated;
}

/** The game so far, replayed with the engine. */
export function gameOf(room: Room): GameState | null {
  if (!room.startFen) return null;
  const v = getVariant(room.variantId);
  let state = createGame(v, room.startFen);
  for (const m of room.moves) state = makeMove(v, state, findMove(v, state, m.from, m.to, m.promotion)!);
  return state;
}

function finish(room: Room, outcome: OnlineOutcome, now: number): Room {
  return { ...room, phase: 'over', outcome, drawOffer: null, gone: {}, clock: stopClock(room.clock, now) };
}

/** Ends the game on time or for a player who stayed away, if either is due at `now`. */
export function tick(room: Room, now: number, state: GameState | null = gameOf(room)): Room {
  if (room.phase !== 'playing' || !state) return room;
  const loser = flagged(room.clock, now);
  if (loser) {
    const winner = timeoutWinner(getVariant(room.variantId), state.position, loser);
    return finish(room, { reason: 'timeout', winner }, now);
  }
  const away = (['w', 'b'] as const)
    .filter((c) => room.gone[c] !== undefined && room.gone[c]! <= now)
    .sort((a, b) => room.gone[a]! - room.gone[b]!);
  if (away.length) return finish(room, { reason: 'abandon', winner: opposite(away[0]) }, now);
  return room;
}

/** `color` plays a move; `ply` is the number of moves the client saw (stale moves are refused). */
export function playMove(room: Room, color: Color, move: WireMove, ply: number, now: number): Room {
  const state = gameOf(room);
  room = tick(room, now, state);
  if (room.phase === 'over') return room;
  if (room.phase !== 'playing' || !state) return fail('bad-request');
  if (state.position.turn !== color || ply !== room.moves.length) return fail('not-your-turn');
  const v = getVariant(room.variantId);
  const legal = findMove(v, state, move.from, move.to, move.promotion);
  if (!legal || (legal.promotion !== undefined && legal.promotion !== move.promotion)) return fail('illegal');
  const next = makeMove(v, state, legal);
  const wire: WireMove = legal.promotion
    ? { from: legal.from, to: legal.to, promotion: legal.promotion }
    : { from: legal.from, to: legal.to };
  const played: Room = {
    ...room,
    moves: [...room.moves, wire],
    clock: pressClock(room.clock, color, now),
    // A move answers a pending draw offer with no.
    drawOffer: null,
  };
  return next.result ? finish(played, next.result, now) : played;
}

export function resign(room: Room, color: Color, now: number): Room {
  if (room.phase === 'over') return fail('over');
  if (room.phase !== 'playing') return fail('bad-request');
  return finish(room, { reason: 'resign', winner: opposite(color) }, now);
}

/** Offer (or accept, if the opponent offered) a draw; decline clears the opponent's offer. */
export function draw(room: Room, color: Color, action: 'offer' | 'accept' | 'decline', now: number): Room {
  if (room.phase !== 'playing') return fail('bad-request');
  if (action === 'decline') return room.drawOffer === opposite(color) ? { ...room, drawOffer: null } : room;
  if (room.drawOffer === opposite(color)) return finish(room, { reason: 'agreement', winner: null }, now);
  if (action === 'accept') return room;
  return { ...room, drawOffer: color };
}

/** A player's last connection closed (starts the countdown) or one opened (cancels it). */
export function setConnected(room: Room, color: Color, connected: boolean, now: number): Room {
  const gone = { ...room.gone };
  if (connected) delete gone[color];
  else if (room.phase === 'playing') gone[color] = now + RECONNECT_MS;
  return { ...room, gone };
}

/** When the server must look at the room again (a flag fall or a reconnect deadline), or null. */
export function nextDeadline(room: Room): number | null {
  if (room.phase !== 'playing') return null;
  const times: number[] = Object.values(room.gone).filter((t): t is number => t !== undefined);
  const c = room.clock;
  if (c.running && Number.isFinite(c.remaining[c.running])) times.push(c.since + c.remaining[c.running]);
  return times.length ? Math.min(...times) : null;
}

/** What `you` (a seat colour or null for spectators) sees. Tokens and pending setup answers stay hidden. */
export function viewOf(
  room: Room,
  you: Color | null,
  connected: Readonly<Record<Color, boolean>>,
  now: number,
): GameView {
  const player = (c: Color) => {
    const seat = room.seats[c];
    return seat ? { name: seat.name, connected: connected[c], deadline: room.gone[c] ?? null } : null;
  };
  const finite = (ms: number) => (Number.isFinite(ms) ? ms : null);
  return {
    id: room.id,
    variantId: room.variantId,
    timeControlId: room.timeControlId,
    phase: room.phase,
    players: { w: player('w'), b: player('b') },
    you,
    startFen: room.startFen,
    moves: room.moves,
    answered: Object.keys(room.answers),
    clock: {
      remaining: { w: finite(room.clock.remaining.w), b: finite(room.clock.remaining.b) },
      running: room.clock.running,
      since: room.clock.since,
    },
    outcome: room.outcome,
    drawOffer: room.drawOffer,
    now,
  };
}

/** Time left for `color` (for tests and logs). */
export const timeLeft = (room: Room, color: Color, now: number) => remainingMs(room.clock, color, now);
