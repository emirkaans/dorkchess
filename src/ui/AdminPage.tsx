import { useCallback, useEffect, useState } from 'react';
import type {
  AdminError,
  AdminGang,
  AdminLogEntry,
  AdminStats,
  AdminTournament,
  AdminUser,
  StaffRole,
} from '../online/admin.ts';
import { mayDo } from '../online/admin.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';

type Tab = 'stats' | 'users' | 'tournaments' | 'gangs' | 'errors' | 'log';
const TABS: readonly Tab[] = ['stats', 'users', 'tournaments', 'gangs', 'errors', 'log'];

const getJSON = <T,>(path: string): Promise<T | null> =>
  fetch(path, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);

/** A staff action; resolves to an error code, or null when it worked. */
const act = async (path: string, body: unknown = {}): Promise<string | null> => {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (res?.ok) return null;
  return ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'network';
};

/** /admin: running the site, for staff (users.role). The server checks every request. */
export function AdminPage() {
  const { t } = useI18n();
  const account = useAccount();
  const [tab, setTab] = useState<Tab>('stats');
  const role = account.user?.role ?? null;

  if (account.loading) return <main className="tournament-page muted">{t('leaders.loading')}</main>;
  if (!role) {
    return (
      <main className="tournament-page">
        <p className="muted">{t('admin.forbidden')}</p>
      </main>
    );
  }
  return (
    <main className="tournament-page admin-page">
      <header className="tz-head">
        <div className="tz-title">
          <p className="tz-meta">{t(`admin.role.${role}`)}</p>
          <h1 className="tz-section-title admin-title">{t('admin.title')}</h1>
        </div>
      </header>
      <div className="lobby-tabs admin-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {t(`admin.tab.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'stats' && <Stats />}
      {tab === 'users' && <Users role={role} myId={account.user!.id} />}
      {tab === 'tournaments' && <Tournaments />}
      {tab === 'gangs' && <Gangs />}
      {tab === 'errors' && <Errors />}
      {tab === 'log' && <Log />}
    </main>
  );
}

const when = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

function Problem({ code }: { code: string | null }) {
  const { t } = useI18n();
  if (!code) return null;
  const known = ['forbidden', 'self', 'taken', 'name', 'not-found'].includes(code);
  return <p className="error">{t((known ? `admin.error.${code}` : 'admin.error.other') as MessageKey)}</p>;
}

function Stats() {
  const { t } = useI18n();
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => {
    void getJSON<AdminStats>('/api/admin/stats').then(setS);
  }, []);
  if (!s) return <p className="muted">{t('leaders.loading')}</p>;
  const cells: [MessageKey, number][] = [
    ['admin.stat.users', s.users],
    ['admin.stat.usersWeek', s.usersWeek],
    ['admin.stat.online', s.online],
    ['admin.stat.liveGames', s.liveGames],
    ['admin.stat.gamesDay', s.gamesDay],
    ['admin.stat.gamesTotal', s.gamesTotal],
    ['admin.stat.tournamentsOpen', s.tournamentsOpen],
    ['admin.stat.gangs', s.gangs],
    ['admin.stat.banned', s.banned],
    ['admin.stat.errorsDay', s.errorsDay],
  ];
  return (
    <dl className="admin-stats">
      {cells.map(([key, n]) => (
        <div key={key}>
          <dt>{t(key)}</dt>
          <dd>{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function Users({ role, myId }: { role: StaffRole; myId: string }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(
    () => void getJSON<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(q)}`).then(setList),
    [q],
  );
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  const run = async (path: string, body?: unknown) => {
    setProblem(await act(path, body));
    load();
  };

  return (
    <section className="tz-section">
      <label className="analysis-field">
        <span>{t('admin.searchUser')}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={20} />
      </label>
      <Problem code={problem} />
      {!list && <p className="muted">{t('leaders.loading')}</p>}
      <ul className="tz-standings">
        {list?.map((u) => (
          <li key={u.id} className={`tz-row admin-row${u.bannedAt ? ' paused' : ''}`}>
            <span className="admin-main">
              <a href={`/@/${u.username}`}>{u.username}</a>
              {u.role && <span className="admin-tag">{t(`admin.role.${u.role}`)}</span>}
              {u.bannedAt && <span className="admin-tag bad">{t('admin.banned')}</span>}
              <small>
                {t('admin.joined', { date: when(u.createdAt, locale) })} ·{' '}
                {t('tournament.games', { n: String(u.games) })}
                {u.banReason && ` · ${u.banReason}`}
              </small>
            </span>
            {u.id !== myId && (
              <span className="admin-actions">
                {mayDo(role, u.bannedAt ? 'unban' : 'ban', u.role) &&
                  (u.bannedAt ? (
                    <button onClick={() => void run(`/api/admin/users/${u.id}/unban`)}>{t('admin.unban')}</button>
                  ) : (
                    <button
                      className="danger"
                      onClick={() => {
                        const reason = window.prompt(t('admin.banReason', { name: u.username }));
                        if (reason !== null) void run(`/api/admin/users/${u.id}/ban`, { reason });
                      }}
                    >
                      {t('admin.ban')}
                    </button>
                  ))}
                {mayDo(role, 'rename-user', u.role) && (
                  <button
                    onClick={() => {
                      const username = window.prompt(t('admin.renamePrompt', { name: u.username }), u.username);
                      if (username && username !== u.username) {
                        void run(`/api/admin/users/${u.id}/rename`, { username });
                      }
                    }}
                  >
                    {t('admin.rename')}
                  </button>
                )}
                {mayDo(role, 'set-role') && (
                  <select
                    aria-label={t('admin.roleLabel', { name: u.username })}
                    value={u.role ?? ''}
                    onChange={(e) =>
                      void run(`/api/admin/users/${u.id}/role`, { role: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">{t('admin.role.none')}</option>
                    <option value="moderator">{t('admin.role.moderator')}</option>
                    <option value="admin">{t('admin.role.admin')}</option>
                  </select>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tournaments() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<AdminTournament[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = () => void getJSON<AdminTournament[]>('/api/admin/tournaments').then(setList);
  useEffect(load, []);
  return (
    <section className="tz-section">
      <Problem code={problem} />
      {list?.length === 0 && <p className="muted">{t('tournament.none')}</p>}
      <ul className="tz-standings">
        {list?.map((x) => (
          <li key={x.id} className="tz-row admin-row">
            <span className="admin-main">
              <a href={`/tournament/${x.id}`}>{x.name}</a>
              <small>
                {x.owner ?? '—'} · {when(x.startsAt, locale)} → {when(x.endsAt, locale)} ·{' '}
                {t('tournament.playersN', { n: String(x.players) })}
              </small>
            </span>
            <span className="admin-actions">
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm(t('admin.cancelConfirm', { name: x.name }))) return;
                  setProblem(await act(`/api/admin/tournaments/${x.id}/cancel`));
                  load();
                }}
              >
                {t('admin.cancel')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Gangs() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [list, setList] = useState<AdminGang[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(
    () => void getJSON<AdminGang[]>(`/api/admin/gangs?q=${encodeURIComponent(q)}`).then(setList),
    [q],
  );
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  const run = async (path: string, body?: unknown) => {
    setProblem(await act(path, body));
    load();
  };
  return (
    <section className="tz-section">
      <label className="analysis-field">
        <span>{t('admin.searchGang')}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={24} />
      </label>
      <Problem code={problem} />
      <ul className="tz-standings">
        {list?.map((g) => (
          <li key={g.tag} className="tz-row admin-row">
            <span className="admin-main">
              <a href={`/gang/${g.tag}`}>
                [{g.tag}] {g.name}
              </a>
              <small>
                {g.owner} · {t('gang.members', { n: String(g.members), size: '4' })}
              </small>
            </span>
            <span className="admin-actions">
              <button
                onClick={() => {
                  const name = window.prompt(t('admin.renamePrompt', { name: g.name }), g.name);
                  if (name && name !== g.name) void run(`/api/admin/gangs/${g.tag}/rename`, { name });
                }}
              >
                {t('admin.rename')}
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm(t('admin.deleteConfirm', { name: `[${g.tag}] ${g.name}` }))) {
                    void run(`/api/admin/gangs/${g.tag}/delete`);
                  }
                }}
              >
                {t('admin.delete')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Errors() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<AdminError[] | null>(null);
  useEffect(() => {
    void getJSON<AdminError[]>('/api/admin/errors').then(setList);
  }, []);
  if (!list) return <p className="muted">{t('leaders.loading')}</p>;
  if (list.length === 0) return <p className="muted">{t('admin.noErrors')}</p>;
  return (
    <ul className="admin-errors">
      {list.map((e, i) => (
        <li key={i}>
          <small>{when(e.at, locale)}</small>
          <pre>{e.report}</pre>
        </li>
      ))}
    </ul>
  );
}

function Log() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<AdminLogEntry[] | null>(null);
  useEffect(() => {
    void getJSON<AdminLogEntry[]>('/api/admin/log').then(setList);
  }, []);
  if (!list) return <p className="muted">{t('leaders.loading')}</p>;
  if (list.length === 0) return <p className="muted">{t('admin.noLog')}</p>;
  return (
    <ul className="tz-standings">
      {list.map((e, i) => (
        <li key={i} className="tz-row admin-row">
          <span className="admin-main">
            <span>
              <strong>{e.actor}</strong> · {t(`admin.action.${e.action}` as MessageKey)} · {e.target}
              {e.detail && ` → ${e.detail}`}
            </span>
            <small>{when(e.at, locale)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
