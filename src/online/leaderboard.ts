// The leaderboard (server/leaderboard.ts): the best players of each rating
// category. Shared by the browser and the Worker. Pure.

export interface LeaderEntry {
  readonly username: string;
  readonly rating: number;
  readonly provisional: boolean;
  readonly games: number;
}

export interface LeaderCategory {
  /** A rating category ('blitz', 'variant:<id>', 'puzzle', …). */
  readonly category: string;
  readonly players: readonly LeaderEntry[];
}

export interface LeaderboardResponse {
  readonly categories: readonly LeaderCategory[];
}

/** Players shown per category on the overview, and on one category's page. */
export const LEADERS_TOP = 10;
export const LEADERS_PAGE = 100;
/** Players who have not played for this long drop off the board. */
export const LEADERS_ACTIVE_DAYS = 60;
