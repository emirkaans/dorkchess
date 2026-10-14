// Messages between the browser and the online game server (a Cloudflare
// Durable Object per game). Shared by both sides. No React / DOM imports.

import type { Color, GameEndReason, PieceType, Square } from '../engine/index.ts';
import type { GameRecord } from './record.ts';
import type { StickerId } from './stickers.ts';

/** A move on the wire: squares (and the promotion piece); the engine fills in the rest. */
export interface WireMove {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: PieceType;
}

/** How an online game ended: the engine's reasons plus those decided outside the rules. */
export type OnlineEndReason = GameEndReason | 'resign' | 'agreement' | 'timeout' | 'abandon';

export interface OnlineOutcome {
  readonly reason: OnlineEndReason;
  readonly winner: Color | null;
}

export type Phase = 'waiting' | 'setup' | 'playing' | 'over';

/**
 * How long a disconnected player has to come back before losing the game, by
 * time control: up to 3 minutes 15 s, under 10 minutes 30 s, otherwise
 * (10 minutes and more, or no clock) a minute.
 */
export function reconnectMs(control: { readonly initialMs: number | null }): number {
  const ms = control.initialMs;
  if (ms === null || ms >= 10 * 60_000) return 60_000;
  return ms <= 3 * 60_000 ? 15_000 : 30_000;
}

/** Longest player name accepted. */
export const MAX_NAME = 24;

/** Game ids: 8 letters / digits. */
export const GAME_ID = /^[A-Za-z0-9]{8}$/;

export interface CreateRequest {
  readonly variantId: string;
  readonly timeControlId: string;
  /** Colour the creator plays, or 'random'. */
  readonly color: Color | 'random';
  readonly name: string;
  /** Asks for a rated game (it only is when both players are signed in and the game has a clock). */
  readonly rated?: boolean;
}

export interface JoinRequest {
  readonly name: string;
}

/** Answer to create / join: the seat and the secret that proves it. */
export interface SeatTicket {
  readonly gameId: string;
  readonly color: Color;
  readonly token: string;
}

export interface PublicPlayer {
  readonly name: string;
  readonly connected: boolean;
  /** Server time by which a disconnected player must be back (playing phase only). */
  readonly deadline: number | null;
  /** The account's username (links to the profile), or null for a guest. */
  readonly username: string | null;
  /** Rating in this game's category before the game (rated games). */
  readonly rating: number | null;
  readonly provisional: boolean;
  /** What the game changed (rated games, once over). */
  readonly diff: number | null;
  /** Patches the game earned this player (once over). */
  readonly newPatches: readonly string[];
}

/** Everything a client needs to draw the game; sent after every change. */
export interface GameView {
  readonly id: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly phase: Phase;
  readonly players: Readonly<Record<Color, PublicPlayer | null>>;
  /** The game counts for ratings. */
  readonly rated: boolean;
  /** The receiver's colour, or null for a spectator. */
  readonly you: Color | null;
  /** Start position once the setup is done. */
  readonly startFen: string | null;
  readonly moves: readonly WireMove[];
  /** Setup question ids already answered (the answers stay secret until the game starts). */
  readonly answered: readonly string[];
  readonly clock: {
    readonly remaining: Readonly<Record<Color, number | null>>;
    readonly running: Color | null;
    /** Server time when the running clock was started. */
    readonly since: number;
  };
  readonly outcome: OnlineOutcome | null;
  /** Side that offers a draw right now. */
  readonly drawOffer: Color | null;
  /** After the game: the side asking for a rematch, and the new game's id once agreed. */
  readonly rematchOffer: Color | null;
  readonly rematchId: string | null;
  /** Server time when this view was made (clients use it to sync their clocks). */
  readonly now: number;
}

export type ClientMessage =
  | { readonly t: 'hello'; readonly token: string | null }
  /** `lag`: the sender's network round trip in ms (part of it is given back on the clock). */
  | { readonly t: 'move'; readonly move: WireMove; readonly ply: number; readonly lag?: number }
  | { readonly t: 'setup'; readonly answers: Readonly<Record<string, string>> }
  | { readonly t: 'resign' }
  | { readonly t: 'draw'; readonly action: 'offer' | 'accept' | 'decline' }
  | { readonly t: 'rematch'; readonly action: 'offer' | 'accept' | 'decline' }
  /** A taunt sticker (src/online/stickers.ts); players only. */
  | { readonly t: 'sticker'; readonly id: StickerId }
  | { readonly t: 'ping' };

export type ErrorCode = 'illegal' | 'not-your-turn' | 'bad-request' | 'full' | 'not-found' | 'over' | 'rate-limited';

export type ServerMessage =
  | { readonly t: 'view'; readonly view: GameView }
  | { readonly t: 'error'; readonly code: ErrorCode }
  | { readonly t: 'pong'; readonly now: number }
  /** A followed local game changed (or the answer to "hello" for one). */
  | { readonly t: 'record'; readonly record: GameRecord }
  /** To the browser playing a stored local game: how many people follow it now. */
  | { readonly t: 'watchers'; readonly count: number }
  /** A player flashed a sticker (to everyone in the game, spectators too). */
  | { readonly t: 'sticker'; readonly from: Color; readonly id: StickerId };
