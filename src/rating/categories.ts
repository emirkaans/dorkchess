// Which rating a game counts for: standard chess by speed (bullet, blitz,
// rapid, classical), every other variant one rating of its own. Games
// without a clock are never rated. Pure.

import { timeControl } from '../clock/clock.ts';
import { listVariants } from '../engine/index.ts';

export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical';
/** 'bullet' … 'classical' for standard chess, 'variant:<id>' for the others. */
export type RatingCategory = Speed | `variant:${string}`;

export const SPEEDS: readonly Speed[] = ['bullet', 'blitz', 'rapid', 'classical'];

/** Lichess-style speed of a time control, from its estimated length (start + 40 increments); null without a clock. */
export function speedOf(timeControlId: string): Speed | null {
  const tc = timeControl(timeControlId);
  if (tc.id !== timeControlId || tc.initialMs === null) return null;
  const seconds = (tc.initialMs + 40 * tc.incrementMs) / 1000;
  if (seconds < 180) return 'bullet';
  if (seconds < 480) return 'blitz';
  if (seconds < 1500) return 'rapid';
  return 'classical';
}

/** The rating a game counts for, or null when it cannot be rated (no clock, unknown variant). */
export function ratingCategory(variantId: string, timeControlId: string): RatingCategory | null {
  const speed = speedOf(timeControlId);
  const variants = listVariants();
  if (!speed || !variants.some((v) => v.id === variantId)) return null;
  return variantId === variants[0].id ? speed : `variant:${variantId}`;
}

/** Every category, in the order profiles show them. */
export const allCategories = (): RatingCategory[] => [
  ...SPEEDS,
  ...listVariants()
    .slice(1)
    .map((v) => `variant:${v.id}` as const),
];

/** The variant id of a variant category, or null for standard chess speeds. */
export const variantOfCategory = (c: RatingCategory): string | null =>
  c.startsWith('variant:') ? c.slice('variant:'.length) : null;
