import { detectLocale, isLocale } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';
import { PIECE_SETS, setPieceSet } from './pieceSets.ts';
import type { PieceSet } from './pieceSets.ts';

export type BoardTheme = 'punk' | 'klasik' | 'koyu' | 'dork' | PunkTheme;
export type PieceTheme = 'punk' | 'klasik' | 'neon' | PunkTheme;

/** Board and piece themes drawn together: each name is both a board and a piece theme. */
export const PUNK_THEMES = [
  'sprey',
  'kulup',
  'fanzin',
  'ekose',
  'deri',
  'bant',
  'asit',
  'plak',
  'tebesir',
  'koli',
] as const;
type PunkTheme = (typeof PUNK_THEMES)[number];

export interface Prefs {
  readonly boardTheme: BoardTheme;
  readonly pieceTheme: PieceTheme;
  /** How the pieces are drawn: the font, or one of the drawn sets. */
  readonly pieceSet: PieceSet;
  readonly sound: boolean;
  /** Taunt stickers in online games (off: neither shown nor offered). */
  readonly stickers: boolean;
  readonly locale: Locale;
  /** Board width in px chosen by dragging its corner; null: fit the screen. */
  readonly boardSize: number | null;
}

export const BOARD_THEMES: readonly BoardTheme[] = ['punk', 'klasik', 'koyu', 'dork', ...PUNK_THEMES];
export const PIECE_THEMES: readonly PieceTheme[] = ['punk', 'klasik', 'neon', ...PUNK_THEMES];

const DEFAULT_PREFS: Omit<Prefs, 'locale'> = {
  boardTheme: 'punk',
  pieceTheme: 'punk',
  pieceSet: 'glyph',
  sound: true,
  stickers: true,
  boardSize: null,
};
const KEY = 'prefs';

/** Stored preferences; the language defaults to the browser's (Turkish or English). */
export function loadPrefs(): Prefs {
  const stored = loadJSON<Partial<Prefs>>(KEY, {});
  const locale = isLocale(stored.locale) ? stored.locale : detectLocale(navigator.languages ?? [navigator.language]);
  const boardTheme = BOARD_THEMES.includes(stored.boardTheme as BoardTheme)
    ? stored.boardTheme!
    : DEFAULT_PREFS.boardTheme;
  const pieceTheme = PIECE_THEMES.includes(stored.pieceTheme as PieceTheme)
    ? stored.pieceTheme!
    : DEFAULT_PREFS.pieceTheme;
  const pieceSet = PIECE_SETS.includes(stored.pieceSet as PieceSet) ? stored.pieceSet! : DEFAULT_PREFS.pieceSet;
  const boardSize =
    typeof stored.boardSize === 'number' && stored.boardSize >= 200 && stored.boardSize <= 2000
      ? stored.boardSize
      : null;
  return {
    ...DEFAULT_PREFS,
    sound: stored.sound ?? DEFAULT_PREFS.sound,
    stickers: stored.stickers ?? DEFAULT_PREFS.stickers,
    boardTheme,
    pieceTheme,
    pieceSet,
    locale,
    boardSize,
  };
}
export const savePrefs = (p: Prefs) => saveJSON(KEY, p);

/** Applies the themes to the document root (CSS reads data-board / data-pieces). */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.board = p.boardTheme;
  root.dataset.pieces = p.pieceTheme;
  setPieceSet(p.pieceSet);
  root.lang = p.locale;
}
