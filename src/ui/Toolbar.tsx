import { useEffect, useRef, useState } from 'react';
import { AccountButton } from './AccountButton.tsx';
import { LOCALES, isLocale } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { Crown } from './Punk.tsx';
import type { Prefs } from './prefs.ts';

export type Page =
  'home' | 'game' | 'analysis' | 'online' | 'review' | 'signup' | 'profile' | 'puzzles' | 'daily' | 'loading';

interface Props {
  page: Page;
  prefs: Prefs;
  onPrefs: (update: (p: Prefs) => Prefs) => void;
  onHome: () => void;
  /** Play: the online lobby (the computer and two-player games are offered there too). */
  onPlay: () => void;
  onAnalysis: () => void;
  onPuzzles: () => void;
  onHistory: () => void;
  onSettings: () => void;
}

/** Top bar: logo, main menu (home, play, online, analysis, history), language and settings. */
export function Toolbar({ page, prefs, onPrefs, onHome, onPlay, onAnalysis, onPuzzles, onHistory, onSettings }: Props) {
  const { t } = useI18n();
  // Publishes the bar's height as --toolbar-h (the home hero slides under the bar by that much).
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const publish = () => document.documentElement.style.setProperty('--toolbar-h', `${el.offsetHeight}px`);
    const observer = new ResizeObserver(publish);
    // Border box: the bar's padding changes with the screen width, its content box may not.
    observer.observe(el, { box: 'border-box' });
    publish();
    return () => observer.disconnect();
  }, []);

  // Phones: the menu folds into a button; any choice (or a page change) closes it.
  const [menuOpen, setMenuOpen] = useState(false);
  const close = (go: () => void) => () => {
    setMenuOpen(false);
    go();
  };

  // On the home page the bar is see-through at the top, over the hero image; once the page scrolls it turns solid.
  const [overHero, setOverHero] = useState(page === 'home');
  useEffect(() => {
    if (page !== 'home') {
      setOverHero(false);
      return;
    }
    const check = () => setOverHero(window.scrollY < 24);
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [page]);

  return (
    <header className={`topbar${overHero ? ' over-hero' : ''}`} ref={ref}>
      <div className="toolbar">
        <button className="logo" onClick={close(onHome)} aria-label={t('menu.logo')}>
          <Crown className="logo-crown" />
          <span className="logo-punk">punk</span>
          <span className="logo-chess">chess</span>
        </button>
        <nav className={`menu${menuOpen ? ' open' : ''}`} id="main-menu" aria-label={t('menu.label')}>
          <button
            className={page === 'online' || page === 'game' ? 'on' : ''}
            aria-current={page === 'online' || page === 'game' ? 'page' : undefined}
            onClick={close(onPlay)}
          >
            {t('menu.play')}
          </button>
          <button
            className={page === 'puzzles' || page === 'daily' ? 'on' : ''}
            aria-current={page === 'puzzles' ? 'page' : undefined}
            onClick={close(onPuzzles)}
          >
            {t('menu.puzzles')}
          </button>
          <button
            className={page === 'analysis' ? 'on' : ''}
            aria-current={page === 'analysis' ? 'page' : undefined}
            onClick={close(onAnalysis)}
          >
            {t('menu.analysis')}
          </button>
          <button onClick={close(onHistory)}>{t('toolbar.history')}</button>
          {menuOpen && (
            <select
              className="lang menu-lang"
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
          )}
        </nav>
        <div className="toolbar-end">
          <AccountButton />
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
          <button
            className="icon-button menu-toggle"
            aria-label={t('menu.label')}
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
            </svg>
          </button>
        </div>
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
