import { useEffect, useRef, useState } from 'react';
import { LOCALES } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { deleteAccount, signInWithGoogle, signOut, useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { GearIcon } from './Punk.tsx';

function PersonIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg className="ic chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

interface Props {
  locale: Locale;
  onLocale: (locale: Locale) => void;
  /** Opens the settings dialog (board, pieces, sound). */
  onSettings: () => void;
}

/**
 * Top bar, as on lichess: the signed-in username (or "Sign in" and a gear for
 * guests) opens a menu with the profile, the language, the settings and the
 * account's own actions.
 */
export function AccountButton({ locale, onLocale, onSettings }: Props) {
  const { t } = useI18n();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  // The menu itself, or its list of languages.
  const [view, setView] = useState<'main' | 'language'>('main');
  // Deleting asks once more inside the menu (the viewer may not allow confirm()).
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Closes the menu on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // Language and settings do not wait for the account: until it is known, the gear is shown.
  const user = account.loading ? null : account.user;
  const toggle = () => {
    setOpen((o) => !o);
    setView('main');
    setConfirming(false);
    setFailed(false);
  };

  return (
    <div className="account" ref={box}>
      {!user && !account.loading && account.canSignIn && (
        <button className="account-button" onClick={() => signInWithGoogle()} title={t('account.signInGoogle')}>
          <PersonIcon />
          <span className="account-label">{t('account.signIn')}</span>
        </button>
      )}
      {user ? (
        <button
          className="account-button on"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          title={user.username}
        >
          <PersonIcon />
          <span className="account-label">{user.username}</span>
        </button>
      ) : (
        <button
          className="icon-button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          aria-label={t('toolbar.settings')}
          title={t('toolbar.settings')}
        >
          <GearIcon />
        </button>
      )}
      {open && view === 'language' && (
        <div className="account-menu" role="menu" aria-label={t('toolbar.language')}>
          <button role="menuitem" className="account-back" onClick={() => setView('main')}>
            <Chevron back />
            {t('toolbar.language')}
          </button>
          {(Object.entries(LOCALES) as [Locale, string][]).map(([code, name]) => (
            <button
              key={code}
              role="menuitemradio"
              aria-checked={code === locale}
              className={code === locale ? 'account-lang on' : 'account-lang'}
              lang={code}
              onClick={() => {
                onLocale(code);
                setView('main');
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {open && view === 'main' && (
        <div className="account-menu" role="menu">
          {user && (
            <a role="menuitem" className="account-profile" href={`/@/${user.username}`}>
              {t('profile.mine')}
            </a>
          )}
          <button role="menuitem" className="account-row" onClick={() => setView('language')}>
            <span>{t('toolbar.language')}</span>
            <span className="account-value">{LOCALES[locale]}</span>
            <Chevron />
          </button>
          <button
            role="menuitem"
            className="account-row"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <span>{t('toolbar.settings')}</span>
            <Chevron />
          </button>
          {user && (
            <div className="account-section">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void signOut().then(() => location.reload());
                }}
              >
                {t('account.signOut')}
              </button>
              {confirming ? (
                <div className="account-confirm">
                  <p>{failed ? t('account.deleteFailed') : t('account.deleteSure')}</p>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      void deleteAccount().then((ok) => (ok ? location.assign('/') : setFailed(true)));
                    }}
                  >
                    {t('account.deleteYes')}
                  </button>
                  <button role="menuitem" onClick={() => setConfirming(false)}>
                    {t('newGame.cancel')}
                  </button>
                </div>
              ) : (
                <button role="menuitem" className="account-delete" onClick={() => setConfirming(true)}>
                  {t('account.delete')}
                </button>
              )}
            </div>
          )}
          <p className="account-links">
            <a href="/privacy">{t('legal.privacy')}</a> · <a href="/terms">{t('legal.terms')}</a>
          </p>
        </div>
      )}
    </div>
  );
}
