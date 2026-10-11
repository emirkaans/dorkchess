// The lobby: open game offers ("seeks") and quick pairing, shared by the
// browser and the Lobby Durable Object (server/lobby.ts). Pure: no React, no
// DOM, no storage. Each seek belongs to one lobby connection and goes away
// with it.

import { timeControl } from '../clock/clock.ts';
import { listVariants } from '../engine/index.ts';
import type { Color } from '../engine/index.ts';
import { cleanName } from './room.ts';
import type { CreateRequest, SeatTicket } from './protocol.ts';

/**
 * Who a lobby player is. Today an anonymous id kept by the browser and a
 * nickname; with accounts the same fields carry the account id, the user name
 * and a rating.
 */
export interface LobbyPlayer {
  readonly id: string;
  readonly name: string;
  readonly rating: number | null;
}

/** An open game offer. */
export interface Seek {
  readonly id: string;
  readonly player: LobbyPlayer;
  readonly variantId: string;
  readonly timeControlId: string;
  /** Colour the seeker plays, or 'random'. */
  readonly color: Color | 'random';
  /** Made by quick pairing (standard chess; pairs with the next quick seek of the same time control). */
  readonly quick: boolean;
  readonly createdAt: number;
}

export type LobbyClientMessage =
  | { readonly t: 'hello'; readonly playerId: string; readonly name: string }
  | { readonly t: 'name'; readonly name: string }
  | {
      readonly t: 'seek';
      readonly variantId: string;
      readonly timeControlId: string;
      readonly color: Color | 'random';
    }
  | { readonly t: 'quick'; readonly timeControlId: string }
  | { readonly t: 'cancel' }
  | { readonly t: 'accept'; readonly seekId: string }
  | { readonly t: 'ping' };

export type LobbyErrorCode = 'bad-request' | 'gone' | 'own-seek';

export type LobbyServerMessage =
  | {
      readonly t: 'state';
      readonly seeks: readonly Seek[];
      /** Players connected to the lobby (distinct ids). */
      readonly online: number;
      /** This connection's own seek, if any. */
      readonly mySeek: string | null;
    }
  /** A game was made: the seat to take (then open /<gameId>). */
  | { readonly t: 'paired'; readonly ticket: SeatTicket }
  | { readonly t: 'error'; readonly code: LobbyErrorCode }
  | { readonly t: 'pong' };

/** Quick pairing plays the first variant (standard chess). */
export const QUICK_VARIANT = (): string => listVariants()[0].id;

/** Time controls offered for quick pairing: all with a clock. */
export const quickTimeControls = (ids: readonly string[]) => ids.filter((id) => timeControl(id).initialMs !== null);

/** Player ids: 8 to 64 letters, digits, '-' or '_'. */
export const PLAYER_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function cleanPlayer(id: unknown, name: unknown): LobbyPlayer | null {
  if (typeof id !== 'string' || !PLAYER_ID.test(id)) return null;
  return { id, name: cleanName(name) || 'punk', rating: null };
}

/** A seek from a client's request, or null when the variant or time control is unknown. */
export function makeSeek(
  id: string,
  player: LobbyPlayer,
  req: { variantId: unknown; timeControlId: unknown; color: unknown },
  quick: boolean,
  now: number,
): Seek | null {
  if (typeof req.variantId !== 'string' || !listVariants().some((v) => v.id === req.variantId)) return null;
  if (typeof req.timeControlId !== 'string' || timeControl(req.timeControlId).id !== req.timeControlId) return null;
  const color = req.color === 'w' || req.color === 'b' ? req.color : 'random';
  return {
    id,
    player,
    variantId: req.variantId,
    timeControlId: req.timeControlId,
    color,
    quick,
    createdAt: now,
  };
}

/** For quick pairing: the oldest quick seek of that time control by someone else. */
export function quickMatch(seeks: readonly Seek[], timeControlId: string, playerId: string): Seek | null {
  let best: Seek | null = null;
  for (const s of seeks) {
    if (!s.quick || s.timeControlId !== timeControlId || s.player.id === playerId) continue;
    if (!best || s.createdAt < best.createdAt) best = s;
  }
  return best;
}

/** The game request of a seek: the seeker's side ('random' decided by `random`). */
export function gameRequest(seek: Seek, random: () => number): CreateRequest & { color: Color } {
  const color: Color = seek.color === 'random' ? (random() < 0.5 ? 'w' : 'b') : seek.color;
  return { variantId: seek.variantId, timeControlId: seek.timeControlId, color, name: seek.player.name };
}

/** Seeks shown in the lobby: oldest first. */
export const sortSeeks = (seeks: readonly Seek[]): Seek[] => [...seeks].sort((a, b) => a.createdAt - b.createdAt);
