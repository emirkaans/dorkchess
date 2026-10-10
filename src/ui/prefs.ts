import { detectLocale, isLocale } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';

export type BoardTheme = 'punk' | 'klasik' | 'koyu' | 'dork';
export type PieceTheme = 'punk' | 'klasik' | 'neon';

export interface Prefs {
  readonly boardTheme: BoardTheme;
  readonly pieceTheme: PieceTheme;
  readonly sound: boolean;
  readonly locale: Locale;
  /** Board width in px chosen by dragging its corner; null: fit the screen. */
  readonly boardSize: number | null;
}

export const BOARD_THEMES: readonly BoardTheme[] = ['punk', 'klasik', 'koyu', 'dork'];
export const PIECE_THEMES: readonly PieceTheme[] = ['punk', 'klasik', 'neon'];

const DEFAULT_PREFS: Omit<Prefs, 'locale'> = { boardTheme: 'punk', pieceTheme: 'punk', sound: true, boardSize: null };
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
  const boardSize =
    typeof stored.boardSize === 'number' && stored.boardSize >= 200 && stored.boardSize <= 2000
      ? stored.boardSize
      : null;
  return { ...DEFAULT_PREFS, sound: stored.sound ?? DEFAULT_PREFS.sound, boardTheme, pieceTheme, locale, boardSize };
}
export const savePrefs = (p: Prefs) => saveJSON(KEY, p);

/** Applies the themes to the document root (CSS reads data-board / data-pieces). */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.board = p.boardTheme;
  root.dataset.pieces = p.pieceTheme;
  root.lang = p.locale;
}
