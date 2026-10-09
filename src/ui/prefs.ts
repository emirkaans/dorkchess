import { loadJSON, saveJSON } from '../storage/local.ts';

export type BoardTheme = 'klasik' | 'koyu' | 'dork';
export type UiMode = 'auto' | 'light' | 'dark';

export interface Prefs {
  readonly boardTheme: BoardTheme;
  readonly ui: UiMode;
  readonly sound: boolean;
}

export const BOARD_THEMES: Record<BoardTheme, string> = { klasik: 'Klasik', koyu: 'Koyu', dork: 'Dork' };
export const UI_MODES: Record<UiMode, string> = { auto: 'Sistem', light: 'Açık', dark: 'Koyu' };

const DEFAULT_PREFS: Prefs = { boardTheme: 'klasik', ui: 'auto', sound: true };
const KEY = 'prefs';

export const loadPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...loadJSON<Partial<Prefs>>(KEY, {}) });
export const savePrefs = (p: Prefs) => saveJSON(KEY, p);

/** Applies the theme to the document root (CSS reads data-board / data-ui). */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.board = p.boardTheme;
  if (p.ui === 'auto') delete root.dataset.ui;
  else root.dataset.ui = p.ui;
}
