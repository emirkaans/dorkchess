// Challenges from a profile: shapes of the challenge API (server/challenges.ts). Pure.

/** An open challenge is offered for this long. */
export const CHALLENGE_TTL_MS = 10 * 60_000;

/** How often a signed-in browser asks for new challenges (while its tab is visible). */
export const CHALLENGE_POLL_MS = 20_000;

export interface Challenge {
  readonly id: string;
  /** Who challenges (username). */
  readonly from: string;
  readonly gameId: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
  readonly createdAt: number;
}

export interface ChallengeList {
  readonly challenges: readonly Challenge[];
}

export interface ChallengeRequest {
  /** Username of the challenged player. */
  readonly to: string;
  readonly gameId: string;
  readonly variantId: string;
  readonly timeControlId: string;
  readonly rated: boolean;
}
