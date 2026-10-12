// Taunt stickers: short punk lines a player can flash at the opponent during
// an online game (no free chat). Shared by the browser and the game room. Pure.

export const STICKERS = ['bored', 'fire', 'what', 'respect', 'comeon', 'oops', 'gg', 'wp'] as const;
export type StickerId = (typeof STICKERS)[number];

export const isSticker = (x: unknown): x is StickerId =>
  typeof x === 'string' && (STICKERS as readonly string[]).includes(x);

/** At most one sticker per player in this time (the game room drops the rest). */
export const STICKER_GAP_MS = 2500;

/** How long a sticker stays on screen. */
export const STICKER_SHOW_MS = 3000;
