// Messages between the browser and the online game server (a Cloudflare
// Durable Object per game). Shared by both sides. No React / DOM imports.

import type { Color, GameEndReason, PieceType, Square } from '../engine/index.ts';

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

/** Seconds a disconnected player has to come back before losing the game. */
export const RECONNECT_MS = 15_000;

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
}

/** Everything a client needs to draw the game; sent after every change. */
export interface GameView {
  readonly id: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly phase: Phase;
  readonly players: Readonly<Record<Color, PublicPlayer | null>>;
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
  /** Server time when this view was made (clients use it to sync their clocks). */
  readonly now: number;
}

export type ClientMessage =
  | { readonly t: 'hello'; readonly token: string | null }
  | { readonly t: 'move'; readonly move: WireMove; readonly ply: number }
  | { readonly t: 'setup'; readonly answers: Readonly<Record<string, string>> }
  | { readonly t: 'resign' }
  | { readonly t: 'draw'; readonly action: 'offer' | 'accept' | 'decline' }
  | { readonly t: 'ping' };

export type ErrorCode = 'illegal' | 'not-your-turn' | 'bad-request' | 'full' | 'not-found' | 'over';

export type ServerMessage =
  | { readonly t: 'view'; readonly view: GameView }
  | { readonly t: 'error'; readonly code: ErrorCode }
  | { readonly t: 'pong'; readonly now: number };
