import { useState } from 'react';
import { deleteAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';

/**
 * Account settings, from the bottom of the player's own profile: out of the
 * way, so deleting the account cannot happen by a stray click. Deleting asks
 * for the username to be typed.
 */
export function AccountSettings({ username, onClose }: { username: string; onClose: () => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const matches = typed.trim().toLowerCase() === username.toLowerCase();

  return (
    <Modal label={t('account.settings')} className="account-modal" onClose={onClose}>
      <h2>{t('account.settings')}</h2>
      <section className="danger-zone" aria-labelledby="delete-title">
        <h3 id="delete-title">{t('account.delete')}</h3>
        <p>{t('account.deleteExplain')}</p>
        <label htmlFor="delete-confirm">{t('account.deleteType', { name: username })}</label>
        <input
          id="delete-confirm"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setTyped(e.target.value);
            setFailed(false);
          }}
        />
        {failed && <p className="error">{t('account.deleteFailed')}</p>}
        <button
          className="danger"
          disabled={!matches || busy}
          onClick={() => {
            setBusy(true);
            void deleteAccount().then((ok) => {
              if (ok) return location.assign('/');
              setBusy(false);
              setFailed(true);
            });
          }}
        >
          {t('account.delete')}
        </button>
      </section>
      <div className="modal-actions">
        <button className="primary" onClick={onClose} data-autofocus>
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}
