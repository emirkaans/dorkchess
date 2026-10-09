import { LOCALES, isLocale } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { BOARD_THEMES, UI_MODES } from './prefs.ts';
import type { BoardTheme, Prefs, UiMode } from './prefs.ts';

interface Props {
  label: string;
  prefs: Prefs;
  onPrefs: (update: (p: Prefs) => Prefs) => void;
  onRules: () => void;
  onHistory: () => void;
  onNewGame: () => void;
}

/** Top bar: game label, rules, history, theme / interface / language / sound preferences, new game. */
export function Toolbar({ label, prefs, onPrefs, onRules, onHistory, onNewGame }: Props) {
  const { t } = useI18n();
  return (
    <header className="toolbar">
      <h1>dorkchess</h1>
      <span className="muted game-label">{label}</span>
      <button onClick={onRules}>{t('toolbar.rules')}</button>
      <button onClick={onHistory}>{t('toolbar.history')}</button>
      <label className="pref">
        {t('toolbar.theme')}{' '}
        <select
          value={prefs.boardTheme}
          onChange={(e) => onPrefs((p) => ({ ...p, boardTheme: e.target.value as BoardTheme }))}
        >
          {BOARD_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {t(`theme.${theme}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="pref">
        {t('toolbar.interface')}{' '}
        <select value={prefs.ui} onChange={(e) => onPrefs((p) => ({ ...p, ui: e.target.value as UiMode }))}>
          {UI_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`ui.${m}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="pref">
        {t('toolbar.language')}{' '}
        <select
          value={prefs.locale}
          onChange={(e) => {
            const locale = e.target.value;
            if (isLocale(locale)) onPrefs((p) => ({ ...p, locale }));
          }}
        >
          {Object.entries(LOCALES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => onPrefs((p) => ({ ...p, sound: !p.sound }))}
        aria-pressed={prefs.sound}
        title={prefs.sound ? t('toolbar.mute') : t('toolbar.unmute')}
      >
        {prefs.sound ? t('toolbar.soundOn') : t('toolbar.soundOff')}
      </button>
      <button onClick={onNewGame}>{t('toolbar.newGame')}</button>
    </header>
  );
}
