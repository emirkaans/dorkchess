import { useEffect, useState } from 'react';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';

interface Found {
  readonly username: string;
}

/** Goes to a page of the app without reloading (App follows the address). */
const go = (path: string) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
};

/** The top bar's search: players by the start of their username. */
export function PlayerSearch() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-button player-search-button"
        aria-label={t('search.players')}
        title={t('search.players')}
        onClick={() => setOpen(true)}
      >
        <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
        </svg>
      </button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);

  useEffect(() => {
    const name = q.trim();
    if (name.length < 2) return setFound(null);
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/users?q=${encodeURIComponent(name)}`)
        .then((r) => (r.ok ? (r.json() as Promise<Found[]>) : []))
        .then((list) => live && setFound(list))
        .catch(() => live && setFound([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <Modal label={t('search.players')} onClose={onClose} className="player-search">
      <label className="analysis-field">
        <span>{t('search.players')}</span>
        <input
          autoFocus
          value={q}
          maxLength={20}
          placeholder={t('search.placeholder')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found?.[0]) {
              onClose();
              go(`/@/${found[0].username}`);
            }
          }}
        />
      </label>
      {found && found.length === 0 && <p className="muted">{t('search.none')}</p>}
      {found && found.length > 0 && (
        <ul className="player-search-list">
          {found.map((f) => (
            <li key={f.username}>
              <a
                href={`/@/${f.username}`}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  go(`/@/${f.username}`);
                }}
              >
                {f.username}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
