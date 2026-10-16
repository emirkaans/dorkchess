// Spray tags: a player's signature, sprayed on the board when they checkmate
// (src/ui/SprayTag.tsx). The tag is the username in a graffiti style; five
// styles are open to everyone, the others are earned like jackets. The fonts
// are Google Fonts, loaded only when a tag is shown. Shared by the browser
// and the Worker. Pure.

import { progress } from './jackets.ts';
import type { JacketNeed, JacketStats } from './jackets.ts';

/** What is drawn around the letters. */
export type TagDeco = 'underline' | 'drips' | 'halo' | 'crown' | 'star' | 'arrow' | 'none';

export interface TagStyle {
  readonly id: string;
  /** A Google Fonts family. */
  readonly font: string;
  readonly color: string;
  /** The darker outline of the letters. */
  readonly outline: string;
  readonly deco: TagDeco;
  /** What earns it (none: open to everyone). */
  readonly need?: JacketNeed;
}

/** Every style, in the order the picker shows them: the open ones first. */
export const TAG_STYLES: readonly TagStyle[] = [
  { id: 'riot', font: 'Permanent Marker', color: '#ff2e93', outline: '#3d0020', deco: 'underline' },
  { id: 'acid', font: 'Rubik Wet Paint', color: '#c6ff3d', outline: '#1e2a00', deco: 'drips' },
  { id: 'cloud', font: 'Rubik Spray Paint', color: '#f1eee8', outline: '#2a2a2e', deco: 'halo' },
  { id: 'stencil', font: 'Black Ops One', color: '#ffd23f', outline: '#3a2c00', deco: 'none' },
  { id: 'scrawl', font: 'Rock Salt', color: '#3fd8ff', outline: '#002a36', deco: 'underline' },
  {
    id: 'crowned',
    font: 'Bangers',
    color: '#ff2e93',
    outline: '#0a0a0b',
    deco: 'crown',
    need: { kind: 'mates', n: 1 },
  },
  {
    id: 'bubble',
    font: 'Rubik Bubbles',
    color: '#ff8de0',
    outline: '#3d0030',
    deco: 'star',
    need: { kind: 'games', n: 10 },
  },
  { id: 'toxic', font: 'Nosifer', color: '#9dff00', outline: '#102000', deco: 'drips', need: { kind: 'mates', n: 5 } },
  { id: 'neon', font: 'Monoton', color: '#00f0ff', outline: '#00262b', deco: 'halo', need: { kind: 'patches', n: 5 } },
  {
    id: 'sketch',
    font: 'Londrina Sketch',
    color: '#f1eee8',
    outline: '#0a0a0b',
    deco: 'star',
    need: { kind: 'daily', n: 7 },
  },
  {
    id: 'blood',
    font: 'Creepster',
    color: '#ff2a2a',
    outline: '#2a0000',
    deco: 'drips',
    need: { kind: 'mates', n: 15 },
  },
  {
    id: 'microbe',
    font: 'Rubik Microbe',
    color: '#c6ff3d',
    outline: '#1e2a00',
    deco: 'halo',
    need: { kind: 'rush', n: 25 },
  },
  {
    id: 'chrome',
    font: 'Rubik Glitch',
    color: '#d9d9e0',
    outline: '#1a1a1e',
    deco: 'arrow',
    need: { kind: 'rating', n: 1600 },
  },
  {
    id: 'gold',
    font: 'Bungee Shade',
    color: '#ffc94a',
    outline: '#3a2600',
    deco: 'crown',
    need: { kind: 'rating', n: 1800 },
  },
  { id: 'king', font: 'Frijole', color: '#ff2e93', outline: '#0a0a0b', deco: 'crown', need: { kind: 'mates', n: 30 } },
];

export const DEFAULT_TAG = TAG_STYLES[0].id;

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
