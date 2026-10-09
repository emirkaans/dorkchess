// Bot difficulty levels: the single place for level names, numbers and search settings.

/** How the final move is picked from the root move scores. */
export type PickRule =
  /** 50% a uniformly random legal move, otherwise the best move. */
  | 'random-half'
  /** Weighted random among the best 3 moves (weights from the scores). */
  | 'top3-weighted'
  /** Random among moves within `margin` centipawns of the best. */
  | 'near-best'
  /** The best move; random only among equally scored moves. */
  | 'best';

export interface LevelConfig {
  readonly level: number;
  /** Turkish UI name. */
  readonly name: string;
  /** Maximum search depth in plies. */
  readonly maxDepth: number;
  readonly quiescence: boolean;
  readonly transpositionTable: boolean;
  /** Add the mobility term to the evaluation. */
  readonly mobility: boolean;
  readonly pick: PickRule;
  /** For 'near-best'. */
  readonly margin: number;
  readonly timeLimitMs: number;
}

export const LEVELS: readonly LevelConfig[] = [
  { level: 1, name: 'Çaylak', maxDepth: 1, quiescence: false, transpositionTable: false, mobility: false, pick: 'random-half', margin: 0, timeLimitMs: 100 },
  { level: 2, name: 'Mahalle', maxDepth: 2, quiescence: false, transpositionTable: false, mobility: false, pick: 'top3-weighted', margin: 0, timeLimitMs: 300 },
  { level: 3, name: 'Kulüp', maxDepth: 3, quiescence: true, transpositionTable: false, mobility: false, pick: 'near-best', margin: 50, timeLimitMs: 700 },
  { level: 4, name: 'Usta', maxDepth: 64, quiescence: true, transpositionTable: true, mobility: false, pick: 'best', margin: 0, timeLimitMs: 500 },
  { level: 5, name: 'Dork', maxDepth: 64, quiescence: true, transpositionTable: true, mobility: true, pick: 'best', margin: 0, timeLimitMs: 950 },
];

export function levelConfig(level: number): LevelConfig {
  const cfg = LEVELS.find((l) => l.level === level);
  if (!cfg) throw new Error(`Unknown bot level ${level}`);
  return cfg;
}

/** The bot waits at least this long before answering, however fast it found the move. */
export const MIN_THINK_MS = 400;

/** Search used by the hint button: level 4 settings, 1 second. */
export const HINT = { level: 4, timeLimitMs: 1000 } as const;

/** Time budget for a bot move: the level's limit, or less when the clock is low. */
export function botTimeMs(level: number, clock?: { remainingMs: number; incrementMs: number }): number {
  const limit = levelConfig(level).timeLimitMs;
  if (!clock) return limit;
  return Math.max(1, Math.min(limit, clock.remainingMs / 30 + clock.incrementMs));
}

/** Draw offers: levels 3+ accept when their own evaluation is worse than -150; levels 1-2 always decline. */
export function acceptsDraw(level: number, botScore: number): boolean {
  return level >= 3 && botScore < -150;
}
