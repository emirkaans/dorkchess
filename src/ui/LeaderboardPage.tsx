import { useEffect, useState } from 'react';
import { getVariant } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { LEADERS_ACTIVE_DAYS, LEADERS_TOP } from '../online/leaderboard.ts';
import type { LeaderCategory, LeaderboardResponse } from '../online/leaderboard.ts';
import { variantOfCategory } from '../rating/categories.ts';
import { useI18n } from './i18n.tsx';
import { ProfileLink } from './ProfileLink.tsx';
import { Crown } from './Punk.tsx';

/** /leaderboard: the top players of every rating category; one category opens further down. */
export function LeaderboardPage() {
  const { t, vt } = useI18n();
  const [board, setBoard] = useState<readonly LeaderCategory[] | null | 'failed'>(null);
  const [open, setOpen] = useState<LeaderCategory | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/leaderboard')
      .then((r) => r.json() as Promise<LeaderboardResponse>)
      .then((d) => live && setBoard(d.categories))
      .catch(() => live && setBoard('failed'));
    return () => {
      live = false;
    };
  }, []);

  const name = (c: string) => {
    const v = variantOfCategory(c as never);
    return v ? vt(getVariant(v)).name : t(`rating.${c}` as MessageKey);
  };

  const more = async (category: string) => {
    const d = (await fetch(`/api/leaderboard?category=${encodeURIComponent(category)}`)
      .then((r) => r.json())
      .catch(() => null)) as LeaderboardResponse | null;
    if (d?.categories[0]) setOpen(d.categories[0]);
  };

  const list = (c: LeaderCategory) => (
    <ol className="leader-list">
      {c.players.map((p, i) => (
        <li key={p.username}>
          <span className="leader-place">{i === 0 ? <Crown /> : i + 1}</span>
          <ProfileLink username={p.username}>{p.username}</ProfileLink>
          <span className="leader-rating">
            {p.rating}
            {p.provisional ? '?' : ''}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <main className="profile-page leaderboard-page">
      <div className="profile-head">
        <h1 className="profile-name">{t('leaders.title')}</h1>
        <p className="muted">{t('leaders.sub', { days: String(LEADERS_ACTIVE_DAYS) })}</p>
        <p>
          <a
            className="gang-link"
            href="/gangs"
            onClick={(e) => {
              e.preventDefault();
              history.pushState(null, '', '/gangs');
              dispatchEvent(new PopStateEvent('popstate'));
            }}
          >
            ⚑ {t('gang.title')} →
          </a>
        </p>
      </div>

      {board === null && <p className="muted">{t('leaders.loading')}</p>}
      {board === 'failed' && <p className="muted">{t('leaders.failed')}</p>}

      {open && (
        <section className="leader-card open" aria-label={name(open.category)}>
          <header>
            <h2>{name(open.category)}</h2>
            <button className="chip" onClick={() => setOpen(null)}>
              {t('leaders.back')}
            </button>
          </header>
          {open.players.length ? list(open) : <p className="muted">{t('leaders.empty')}</p>}
        </section>
      )}

      {!open && Array.isArray(board) && (
        <div className="leader-grid">
          {board.map((c) => (
            <section key={c.category} className="leader-card" aria-label={name(c.category)}>
              <header>
                <h2>{name(c.category)}</h2>
                {c.players.length >= LEADERS_TOP && (
                  <button className="chip" onClick={() => void more(c.category)}>
                    {t('leaders.more')}
                  </button>
                )}
              </header>
              {c.players.length ? list(c) : <p className="muted">{t('leaders.empty')}</p>}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
