// Chess clock logic. Pure: every function takes the current time (`now`, ms)
// from the caller, so tests can drive it with a fake clock. No React / DOM imports.

import { isInsufficientMaterial, opposite, pieceDef } from '../engine/index.ts';
import type { Color, Position, VariantDefinition } from '../engine/index.ts';

export interface TimeControl {
  readonly id: string;
  /** UI label, e.g. "3+2". */
  readonly label: string;
  /** Starting time per side; null = no clock. */
  readonly initialMs: number | null;
  readonly incrementMs: number;
}

const tc = (minutes: number, incSeconds: number): TimeControl => ({
  id: `${minutes}+${incSeconds}`,
  label: `${minutes}+${incSeconds}`,
  initialMs: minutes * 60_000,
  incrementMs: incSeconds * 1000,
});

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: 'none', label: 'Süresiz', initialMs: null, incrementMs: 0 },
  tc(1, 0),
  tc(3, 2),
  tc(5, 0),
  tc(10, 0),
  tc(15, 10),
];

export function timeControl(id: string): TimeControl {
  return TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS[0];
}

/** Below this the display turns red and shows tenths. */
export const LOW_TIME_MS = 10_000;

export interface ClockState {
  readonly control: TimeControl;
  /** Time left per side, as of `since` for the running side. */
  readonly remaining: Readonly<Record<Color, number>>;
  /** Side whose clock is running, or null (before the first move, or stopped). */
  readonly running: Color | null;
  /** When the running clock was last started. */
  readonly since: number;
  /** True once the game is over: the clock never runs again. */
  readonly stopped: boolean;
}

/** A fresh clock; it does not run until the first move is made. */
export function createClock(control: TimeControl): ClockState {
  const t = control.initialMs ?? Infinity;
  return { control, remaining: { w: t, b: t }, running: null, since: 0, stopped: false };
}

export const isTimed = (c: ClockState) => c.control.initialMs !== null;

/** Time left for `color` at `now`. */
export function remainingMs(c: ClockState, color: Color, now: number): number {
  const base = c.remaining[color];
  return c.running === color ? Math.max(0, base - (now - c.since)) : base;
}

/** The side whose time has run out at `now`, if any. */
export function flagged(c: ClockState, now: number): Color | null {
  return isTimed(c) && c.running && remainingMs(c, c.running, now) <= 0 ? c.running : null;
}

/**
 * `mover` has just moved at `now`: their clock stops and gets the increment,
 * the opponent's starts. The very first move of the game only starts the
 * clock (it costs the mover nothing and adds no increment).
 */
export function pressClock(c: ClockState, mover: Color, now: number): ClockState {
  if (c.stopped || !isTimed(c)) return c;
  const next = opposite(mover);
  if (c.running === null) return { ...c, running: next, since: now };
  const left = remainingMs(c, mover, now);
  return {
    ...c,
    remaining: { ...c.remaining, [mover]: left + c.control.incrementMs },
    running: next,
    since: now,
  };
}

/** Freezes both clocks (game over). */
export function stopClock(c: ClockState, now: number): ClockState {
  if (c.stopped) return c;
  const remaining = { w: remainingMs(c, 'w', now), b: remainingMs(c, 'b', now) };
  return { ...c, remaining, running: null, since: now, stopped: true };
}

/**
 * Result when `loser` runs out of time: the opponent wins, unless the opponent
 * has no mating material by the variant's insufficient-material rule (then a
 * draw). Only the opponent's own pieces (plus kings) are considered.
 */
export function timeoutWinner(v: VariantDefinition, pos: Position, loser: Color): Color | null {
  const winner = opposite(loser);
  const board = pos.board.map((p) => (p && p.color === loser && !pieceDef(v, p.type).royal ? null : p));
  return isInsufficientMaterial(v, { ...pos, board }) ? null : winner;
}

/** "m:ss", or "s.d" seconds in the last 10 seconds. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms < LOW_TIME_MS) return (Math.floor(ms / 100) / 10).toFixed(1);
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
