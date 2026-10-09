// Seedable pseudo-random number generator (mulberry32). Deterministic for a
// given seed, so bot moves can be reproduced in tests and simulations.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniformly chosen element (array must be non-empty). */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: (items) => items[int(items.length)] };
}

/** A seed for callers that don't need reproducibility. */
export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
