// Spray tags: a player's signature, sprayed on the board when they checkmate.
// The tag is the username written with a spray can in a style; five styles
// are open to everyone, the others are earned like jackets. Which styles exist
// and what earns them is here (shared by the browser and the Worker); how each
// one looks is in src/ui/spray/styles.ts. Pure.

import { progress } from './jackets.ts';
import type { JacketNeed, JacketStats } from './jackets.ts';

export interface TagStyle {
  readonly id: string;
  /** What earns it (none: open to everyone). */
  readonly need?: JacketNeed;
}

/** Every style, in the order the picker shows them: the open ones first. */
export const TAG_STYLES: readonly TagStyle[] = [
  { id: 'signature' },
  { id: 'drippy' },
  { id: 'throwup' },
  { id: 'mist' },
  { id: 'calli' },
  { id: 'crown', need: { kind: 'mates', n: 1 } },
  { id: 'toxic', need: { kind: 'mates', n: 5 } },
  { id: 'chaos', need: { kind: 'mates', n: 15 } },
  { id: 'wild', need: { kind: 'mates', n: 30 } },
  { id: 'bubble', need: { kind: 'games', n: 10 } },
  { id: 'neon', need: { kind: 'patches', n: 5 } },
  { id: 'volt', need: { kind: 'daily', n: 7 } },
  { id: 'retro', need: { kind: 'rush', n: 25 } },
  { id: 'chrome', need: { kind: 'rating', n: 1600 } },
  { id: 'night', need: { kind: 'rating', n: 1800 } },
];

export const DEFAULT_TAG = TAG_STYLES[0].id;

/** A style by id; an unknown one (or none picked yet) is the first. */
export const tagById = (id: string | null | undefined): TagStyle =>
  TAG_STYLES.find((s) => s.id === id) ?? TAG_STYLES[0];

export const tagOpen = (style: TagStyle, stats: JacketStats): boolean =>
  !style.need || progress(style.need, stats) >= style.need.n;

/** A small deterministic random sequence from a text (the same tag sprays the same way). */
export function seeded(text: string): () => number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
