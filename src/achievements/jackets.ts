// Battle jackets: the jacket a player's patches are sewn on. Some are open to
// everyone, the others are earned. The pictures are in public/jackets/
// (<id>.webp and a small <id>-thumb.webp). Shared by the browser and the Worker. Pure.

/** What a player has done, for the jackets that are earned. */
export interface JacketStats {
  readonly patches: number;
  /** Online games finished. */
  readonly games: number;
  /** Best settled (not provisional) game rating, or null. */
  readonly bestRating: number | null;
  readonly rushBest: number;
  /** Longest run of daily puzzles solved in a row. */
  readonly dailyBest: number;
  /** Online games won by checkmate (missing in older callers: none). */
  readonly mates?: number;
}

export type JacketNeed =
  | { readonly kind: 'patches'; readonly n: number }
  | { readonly kind: 'games'; readonly n: number }
  | { readonly kind: 'rating'; readonly n: number }
  | { readonly kind: 'rush'; readonly n: number }
  | { readonly kind: 'daily'; readonly n: number }
  | { readonly kind: 'mates'; readonly n: number };

export interface JacketDef {
  readonly id: string;
  /** What earns it (none: open to everyone). */
  readonly need?: JacketNeed;
}

/** Every jacket, in the order the picker shows them. */
export const JACKETS: readonly JacketDef[] = [
  { id: 'pink-riot' },
  { id: 'denim-storm' },
  { id: 'gray-street' },
  { id: 'bondage', need: { kind: 'patches', n: 3 } },
  { id: 'scarlet', need: { kind: 'games', n: 10 } },
  { id: 'studded', need: { kind: 'patches', n: 5 } },
  { id: 'patchwork', need: { kind: 'daily', n: 7 } },
  { id: 'full-kit', need: { kind: 'patches', n: 10 } },
  { id: 'blood-queen', need: { kind: 'rating', n: 1800 } },
  { id: 'midnight', need: { kind: 'rush', n: 30 } },
  { id: 'desert-rat', need: { kind: 'daily', n: 30 } },
];

export const DEFAULT_JACKET = JACKETS[0].id;

export const jacketById = (id: string | null | undefined): JacketDef => JACKETS.find((j) => j.id === id) ?? JACKETS[0];

/** How far the player is toward a need: the number to compare with `need.n`. */
export function progress(need: JacketNeed, s: JacketStats): number {
  switch (need.kind) {
    case 'patches':
      return s.patches;
    case 'games':
      return s.games;
    case 'rating':
      return s.bestRating ?? 0;
    case 'rush':
      return s.rushBest;
    case 'daily':
      return s.dailyBest;
    case 'mates':
      return s.mates ?? 0;
  }
}

export const jacketOpen = (j: JacketDef, s: JacketStats): boolean => !j.need || progress(j.need, s) >= j.need.n;

/** The longest run of consecutive days ('YYYY-MM-DD') in a list. */
export function longestRun(days: readonly string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}
