// A game as stored on the server so anyone with its link can open it:
// local games (against the bot, two players on one screen) are uploaded by
// the browser that plays them; online games are described from their room.
// Pure: no React, no DOM.

import { createGame, getVariant, listVariants, playSan, toFen } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { GAME_ID } from './protocol.ts';
import { gameOf } from './room.ts';
import type { Room } from './room.ts';

export type RecordResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface GameRecord {
  readonly variantId: string;
  readonly startFen: string;
  /** Moves in SAN. */
  readonly moves: readonly string[];
  /** Player labels as shown (bot level or "Human" for local games, nicknames online). */
  readonly white: string;
  readonly black: string;
  /** 'hotseat' | 'bot' | 'botvbot' | 'online'. */
  readonly mode: string;
  readonly timeControlId: string;
  readonly result: RecordResult;
  /** End reason code ('checkmate', 'resign', …); '' while the game goes on. */
  readonly termination: string;
  /** ISO time of the last update. */
  readonly date: string;
}

/** What GET /api/games/:id answers. */
export type GameInfo =
  | { readonly kind: 'online'; readonly phase: Room['phase']; readonly record: GameRecord | null }
  | { readonly kind: 'local'; readonly record: GameRecord };

/** PUT /api/games/:id/record body: the record and the secret of the browser that owns the game. */
export interface RecordUpload {
  readonly record: GameRecord;
  readonly owner: string;
}

export const MAX_MOVES = 1000;
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A new game id: 8 letters / digits from a secure random source (browser or worker). */
export function randomGameId(): string {
  const bytes = (
    globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

export const isGameId = (id: string) => GAME_ID.test(id);

const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');

/**
 * Checks an uploaded record: known variant, a readable start position and
 * moves that are all legal from it (replayed with the engine). Returns a clean
 * copy, or null when it is not a valid game.
 */
export function validateRecord(raw: unknown): GameRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const variantId = text(r.variantId, 40);
  if (!listVariants().some((v) => v.id === variantId)) return null;
  const moves = Array.isArray(r.moves) ? r.moves : null;
  if (!moves || moves.length > MAX_MOVES || !moves.every((m) => typeof m === 'string' && m.length <= 12)) return null;
  const v = getVariant(variantId);
  try {
    const start = createGame(v, text(r.startFen, 200) || v.startPosition);
    playSan(v, start, ...(moves as string[]));
  } catch {
    return null;
  }
  const result = (['1-0', '0-1', '1/2-1/2', '*'] as const).find((x) => x === r.result) ?? '*';
  return {
    variantId,
    startFen: text(r.startFen, 200) || v.startPosition,
    moves: moves as string[],
    white: text(r.white, 40),
    black: text(r.black, 40),
    mode: text(r.mode, 20),
    timeControlId: text(r.timeControlId, 20),
    result,
    termination: text(r.termination, 40),
    date: text(r.date, 40) || new Date().toISOString(),
  };
}

/** The record of an online game (null before it starts). */
export function recordOfRoom(room: Room): GameRecord | null {
  const state: GameState | null = gameOf(room);
  if (!state || !room.startFen) return null;
  const o = room.outcome;
  const v = getVariant(room.variantId);
  return {
    variantId: room.variantId,
    startFen: toFen(v, createGame(v, room.startFen).position),
    moves: state.moves.map((m) => m.san),
    white: room.seats.w?.name ?? '',
    black: room.seats.b?.name ?? '',
    mode: 'online',
    timeControlId: room.timeControlId,
    result: !o ? '*' : o.winner === 'w' ? '1-0' : o.winner === 'b' ? '0-1' : '1/2-1/2',
    termination: o?.reason ?? '',
    date: new Date().toISOString(),
  };
}

/** Every position of a record, replayed with the engine. */
export function statesOfRecord(r: GameRecord): GameState[] {
  const v = getVariant(r.variantId);
  const out = [createGame(v, r.startFen)];
  for (const san of r.moves) out.push(playSan(v, out[out.length - 1], san));
  return out;
}
