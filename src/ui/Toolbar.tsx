import { LOCALES, isLocale } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { Crown } from './Punk.tsx';
import type { Prefs } from './prefs.ts';

export type Page = 'home' | 'game';

interface Props {
  page: Page;
  prefs: Prefs;
  onPrefs: (update: (p: Prefs) => Prefs) => void;
  onHome: () => void;
  onPlay: () => void;
  onHistory: () => void;
  onSettings: () => void;
}

/** Top bar: logo, main menu (home, play, history), language and settings. */
export function Toolbar({ page, prefs, onPrefs, onHome, onPlay, onHistory, onSettings }: Props) {
  const { t } = useI18n();
  return (
    <header className="toolbar">
      <button className="logo" onClick={onHome} aria-label={t('menu.logo')}>
        <Crown className="logo-crown" />
        <span className="logo-punk">punk</span>
        <span className="logo-chess">chess</span>
      </button>
      <nav className="menu" aria-label={t('menu.label')}>
        <button
          className={page === 'home' ? 'on' : ''}
          aria-current={page === 'home' ? 'page' : undefined}
          onClick={onHome}
        >
          {t('menu.home')}
        </button>
        <button
          className={page === 'game' ? 'on' : ''}
          aria-current={page === 'game' ? 'page' : undefined}
          onClick={onPlay}
        >
          {t('menu.play')}
        </button>
        <button onClick={onHistory}>{t('toolbar.history')}</button>
      </nav>
      <div className="toolbar-end">
        <select
          className="lang"
          aria-label={t('toolbar.language')}
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
        <button
          className="icon-button"
          onClick={onSettings}
          aria-label={t('toolbar.settings')}
          title={t('toolbar.settings')}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

export function GearIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  );
}
