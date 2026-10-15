import { useEffect, useState } from 'react';
import { GANG_POINTS, GANG_WEEK_DAYS, cleanTag, gangProblem } from '../online/gang.ts';
import type { GangDetail, GangList } from '../online/gang.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { ProfileLink } from './ProfileLink.tsx';
import { Crown } from './Punk.tsx';

const post = (path: string, body?: unknown) =>
  fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);

/** /gangs: gangs by weekly score, and founding one. /gang/<TAG>: one gang. */
export function GangsPage({ tag, onOpen }: { tag: string | null; onOpen: (path: string) => void }) {
  return tag ? <GangView tag={tag} onOpen={onOpen} /> : <GangIndex onOpen={onOpen} />;
}

function Rules() {
  const { t } = useI18n();
  return (
    <p className="muted">
      {t('gang.rules', {
        days: String(GANG_WEEK_DAYS),
        win: String(GANG_POINTS.win),
        draw: String(GANG_POINTS.draw),
        daily: String(GANG_POINTS.daily),
      })}
    </p>
  );
}

function GangIndex({ onOpen }: { onOpen: (path: string) => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [data, setData] = useState<GangList | null>(null);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/gangs', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<GangList>)
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const found = async () => {
    const problem = gangProblem(name, tag);
    if (problem) return setError(`gang.problem.${problem}`);
    setBusy(true);
    const res = await post('/api/gangs', { name, tag });
    setBusy(false);
    if (res?.ok) return onOpen(`/gang/${cleanTag(tag)}`);
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'network';
    setError(
      (['name', 'tag', 'taken', 'in-gang'].includes(code)
        ? `gang.problem.${code}`
        : 'signup.problem.network') as MessageKey,
    );
  };

  return (
    <main className="profile-page gangs-page">
      <div className="profile-head">
        <div className="profile-title">
          <h1 className="profile-name">{t('gang.title')}</h1>
          <Rules />
        </div>
      </div>

      {!data && <p className="muted">{t('leaders.loading')}</p>}
      {data && (
        <ol className="gang-list">
          {data.gangs.length === 0 && <li className="muted gang-empty">{t('gang.none')}</li>}
          {data.gangs.map((g, i) => (
            <li key={g.tag} className={g.tag === data.mine ? 'mine' : ''}>
              <span className="leader-place">{i === 0 && g.score > 0 ? <Crown /> : i + 1}</span>
              <a
                href={`/gang/${g.tag}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(`/gang/${g.tag}`);
                }}
              >
                <strong>[{g.tag}]</strong> {g.name}
              </a>
              <span className="muted">{t('gang.members', { n: String(g.members) })}</span>
              <span className="gang-score">{g.score}</span>
            </li>
          ))}
        </ol>
      )}

      {data && account.user && !data.mine && (
        <form
          className="gang-form"
          onSubmit={(e) => {
            e.preventDefault();
            void found();
          }}
        >
          <h2>{t('gang.found')}</h2>
          <label>
            <span>{t('gang.name')}</span>
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>{t('gang.tag')}</span>
            <input value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase())} />
          </label>
          {error && <p className="error">{t(error)}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {t('gang.foundButton')}
          </button>
        </form>
      )}
      {data && !account.user && !account.loading && <p className="muted">{t('gang.signIn')}</p>}
    </main>
  );
}

function GangView({ tag, onOpen }: { tag: string; onOpen: (path: string) => void }) {
  const { t, locale } = useI18n();
  const account = useAccount();
  const [gang, setGang] = useState<GangDetail | null | 'missing'>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch(`/api/gangs/${encodeURIComponent(tag)}`).then((r) => (r.ok ? (r.json() as Promise<GangDetail>) : null)),
      fetch('/api/gangs', { credentials: 'same-origin' }).then((r) => r.json() as Promise<GangList>),
    ])
      .then(([g, list]) => {
        if (!live) return;
        setGang(g ?? 'missing');
        setMine(list.mine);
      })
      .catch(() => live && setGang('missing'));
    return () => {
      live = false;
    };
  }, [tag, reload]);

  if (gang === null)
    return (
      <main className="profile-page">
        <p className="muted">{t('leaders.loading')}</p>
      </main>
    );
  if (gang === 'missing')
    return (
      <main className="profile-page">
        <p className="muted">{t('gang.missing')}</p>
      </main>
    );
  const member = mine === gang.tag;
  const act = async (what: 'join' | 'leave') => {
    setError(null);
    const res = await post(`/api/gangs/${gang.tag}/${what}`);
    if (res?.ok) return setReload((n) => n + 1);
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
    setError(
      code === 'full' ? 'gang.problem.full' : code === 'in-gang' ? 'gang.problem.in-gang' : 'signup.problem.network',
    );
  };

  return (
    <main className="profile-page gangs-page">
      <div className="profile-head">
        <div className="profile-title">
          <h1 className="profile-name">
            [{gang.tag}] {gang.name}
          </h1>
          <p className="muted">
            {t('gang.members', { n: String(gang.members) })} ·{' '}
            {t('gang.since', { date: new Date(gang.createdAt).toLocaleDateString(locale) })} ·{' '}
            <a
              href="/gangs"
              onClick={(e) => {
                e.preventDefault();
                onOpen('/gangs');
              }}
            >
              {t('gang.all')}
            </a>
          </p>
          {account.user && (
            <div className="profile-actions">
              {member ? (
                <button onClick={() => void act('leave')}>{t('gang.leave')}</button>
              ) : !mine ? (
                <button className="primary" onClick={() => void act('join')}>
                  {t('gang.join')}
                </button>
              ) : null}
            </div>
          )}
          {error && <p className="error">{t(error)}</p>}
        </div>
        <span className="gang-total">
          <small>{t('gang.week')}</small>
          {gang.score}
        </span>
      </div>
      <Rules />
      <ol className="gang-list">
        {gang.list.map((m, i) => (
          <li key={m.username}>
            <span className="leader-place">{i + 1}</span>
            <ProfileLink username={m.username}>{m.username}</ProfileLink>
            <span className="muted">{m.owner ? t('gang.founder') : ''}</span>
            <span className="gang-score">{m.score}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
