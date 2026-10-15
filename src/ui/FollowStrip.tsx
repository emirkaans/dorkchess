import { useEffect, useState } from 'react';
import { FOLLOW_POLL_MS } from '../online/follow.ts';
import type { FollowStatus, FollowingResponse } from '../online/follow.ts';
import { useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { ProfileLink } from './ProfileLink.tsx';

/**
 * Followed players who are on the site now: playing (click to watch their
 * game) or in the lobby (click for their profile). Hidden when none are.
 */
export function FollowStrip({ onOpenGame }: { onOpenGame: (id: string) => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [list, setList] = useState<readonly FollowStatus[]>([]);
  const signedIn = !account.loading && !!account.user;

  useEffect(() => {
    if (!signedIn) return setList([]);
    let live = true;
    const ask = async () => {
      if (document.hidden) return;
      const res = await fetch('/api/follows', { credentials: 'same-origin' }).catch(() => null);
      if (!live || !res?.ok) return;
      const { following } = (await res.json()) as FollowingResponse;
      setList(following.filter((f) => f.status !== 'offline'));
    };
    void ask();
    const id = setInterval(() => void ask(), FOLLOW_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [signedIn]);

  if (!list.length) return null;
  return (
    <p className="follow-strip" aria-label={t('follow.title')}>
      <span>{t('follow.title')}:</span>
      {list.slice(0, 6).map((f) =>
        f.status === 'playing' && f.gameId ? (
          <button key={f.username} className="follow-chip playing" onClick={() => onOpenGame(f.gameId!)}>
            <span className="dot" aria-hidden="true" />
            {f.username} · {t('follow.playing')}
          </button>
        ) : (
          <span key={f.username} className="follow-chip">
            <span className="dot" aria-hidden="true" />
            <ProfileLink username={f.username}>{f.username}</ProfileLink> · {t('follow.lobby')}
          </span>
        ),
      )}
    </p>
  );
}
