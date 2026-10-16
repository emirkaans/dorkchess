// Following other players: shapes of the follow API (server/follows.ts). Pure.

/** A followed player and what they are doing now. */
export interface FollowStatus {
  readonly username: string;
  /** Playing an online game (gameId set), in the lobby, or neither. */
  readonly status: 'playing' | 'lobby' | 'offline';
  readonly gameId: string | null;
}

export interface FollowingResponse {
  readonly following: readonly FollowStatus[];
}

/** Lobby → Worker: which of the asked names are in the lobby, and in which games. */
export interface Presence {
  readonly lobby: readonly string[];
  /** Username → id of the game they are playing. */
  readonly games: Readonly<Record<string, string>>;
}

/** Most players one can follow. */
export const MAX_FOLLOWING = 200;

/** How often the lobby page asks what followed players are doing (while visible). */
export const FOLLOW_POLL_MS = 30_000;

/** Followed players playing first, then those in the lobby, then the rest; by name within each. */
export function sortFollowing(list: readonly FollowStatus[]): FollowStatus[] {
  const rank = { playing: 0, lobby: 1, offline: 2 } as const;
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || a.username.localeCompare(b.username));
}

/** GET /api/me/follows: the signed-in player's followers and the players they follow, newest first. */
export interface FollowLists {
  readonly followers: readonly string[];
  readonly following: readonly string[];
}
