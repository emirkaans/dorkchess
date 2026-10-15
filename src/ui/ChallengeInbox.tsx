import { useEffect, useState } from 'react';
import { timeControl } from '../clock/clock.ts';
import { getVariant } from '../engine/index.ts';
import { CHALLENGE_POLL_MS } from '../online/challenge.ts';
import type { Challenge, ChallengeList } from '../online/challenge.ts';
import { useAccount } from './account.ts';
import { useAttention } from './attention.ts';
import { useI18n } from './i18n.tsx';
import { joinOnlineGame } from './online/connection.ts';
import { playSound } from './sound.ts';

const answer = (id: string, what: 'accept' | 'decline') =>
  fetch(`/api/challenges/${id}/${what}`, { method: 'POST', credentials: 'same-origin' }).catch(() => null);

/**
 * Challenges to the signed-in player, wherever they are on the site: asked for
 * every CHALLENGE_POLL_MS while the tab is visible, shown in a corner with
 * accept and decline. Accepting joins the game and opens it.
 */
export function ChallengeInbox({ sound, onOpenGame }: { sound: boolean; onOpenGame: (id: string) => void }) {
  const { t, vt } = useI18n();
  const account = useAccount();
  const [list, setList] = useState<readonly Challenge[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const signedIn = !account.loading && !!account.user;

  useEffect(() => {
    if (!signedIn) return setList([]);
    let live = true;
    let seen = new Set<string>();
    const ask = async () => {
      if (document.hidden) return;
      const res = await fetch('/api/challenges', { credentials: 'same-origin' }).catch(() => null);
      if (!live || !res?.ok) return;
      const { challenges } = (await res.json()) as ChallengeList;
      // A new challenge makes a sound once.
      if (challenges.some((c) => !seen.has(c.id)) && seen.size + challenges.length > 0 && sound) playSound('start');
      seen = new Set(challenges.map((c) => c.id));
      setList(challenges);
    };
    void ask();
    const id = setInterval(() => void ask(), CHALLENGE_POLL_MS);
    const onShow = () => void ask();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [signedIn, sound]);

  const c = list[0] ?? null;
  useAttention(c ? t('challenge.flash', { name: c.from }) : null);
  if (!c || !account.user) return null;

  const tc = timeControl(c.timeControlId);
  const drop = () => setList((l) => l.filter((x) => x.id !== c.id));
  return (
    <div className="challenge-toast" role="alertdialog" aria-label={t('challenge.title')}>
      <p>
        <strong>{c.from}</strong> {t('challenge.text')}
      </p>
      <p className="muted">
        {vt(getVariant(c.variantId)).name} · {tc.initialMs === null ? t('time.none') : tc.label} ·{' '}
        {t(c.rated ? 'lobby.rated' : 'lobby.casual')}
      </p>
      {failed && <p className="error">{t('challenge.gone')}</p>}
      <div className="challenge-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void answer(c.id, 'accept');
            joinOnlineGame(c.gameId, account.user!.username)
              .then(() => {
                drop();
                onOpenGame(c.gameId);
              })
              .catch(() => setFailed(true))
              .finally(() => setBusy(false));
          }}
        >
          {t('challenge.accept')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void answer(c.id, 'decline');
            drop();
            setFailed(false);
          }}
        >
          {t('challenge.decline')}
        </button>
      </div>
    </div>
  );
}
