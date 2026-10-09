import { detectLocale, isLocale } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';

export type BoardTheme = 'klasik' | 'koyu' | 'dork';
export type UiMode = 'auto' | 'light' | 'dark';

export interface Prefs {
  readonly boardTheme: BoardTheme;
  readonly ui: UiMode;
  readonly sound: boolean;
  readonly locale: Locale;
}

export const BOARD_THEMES: readonly BoardTheme[] = ['klasik', 'koyu', 'dork'];
export const UI_MODES: readonly UiMode[] = ['auto', 'light', 'dark'];

const DEFAULT_PREFS: Omit<Prefs, 'locale'> = { boardTheme: 'klasik', ui: 'auto', sound: true };
const KEY = 'prefs';

/** Stored preferences; the language defaults to the browser's (Turkish or English). */
export function loadPrefs(): Prefs {
  const stored = loadJSON<Partial<Prefs>>(KEY, {});
  const locale = isLocale(stored.locale) ? stored.locale : detectLocale(navigator.languages ?? [navigator.language]);
  return { ...DEFAULT_PREFS, ...stored, locale };
}
export const savePrefs = (p: Prefs) => saveJSON(KEY, p);

/** Applies the theme to the document root (CSS reads data-board / data-ui). */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.board = p.boardTheme;
  root.lang = p.locale;
  if (p.ui === 'auto') delete root.dataset.ui;
  else root.dataset.ui = p.ui;
}
