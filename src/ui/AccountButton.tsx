import { useEffect, useRef, useState } from 'react';
import { deleteAccount, signInWithGoogle, signOut, useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';

function PersonIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

/** Top bar: "Sign in" (with Google), or the signed-in username with a small menu. */
export function AccountButton() {
  const { t } = useI18n();
  const account = useAccount();
  const [open, setOpen] = useState(false);
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

  if (account.loading) return null;
  if (!account.user) {
    if (!account.canSignIn) return null;
    return (
      <button className="account-button" onClick={() => signInWithGoogle()} title={t('account.signInGoogle')}>
        <PersonIcon />
        <span className="account-label">{t('account.signIn')}</span>
      </button>
    );
  }
  return (
    <div className="account" ref={box}>
      <button
        className="account-button on"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setConfirming(false);
          setFailed(false);
        }}
        title={account.user.username}
      >
        <PersonIcon />
        <span className="account-label">{account.user.username}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-name">{account.user.username}</p>
          <a role="menuitem" className="account-profile" href={`/@/${account.user.username}`}>
            {t('profile.mine')}
          </a>
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
          <p className="account-links">
            <a href="/privacy">{t('legal.privacy')}</a> · <a href="/terms">{t('legal.terms')}</a>
          </p>
        </div>
      )}
    </div>
  );
}
