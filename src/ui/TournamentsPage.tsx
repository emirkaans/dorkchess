import { useEffect, useState } from 'react';
import { timeControl } from '../clock/clock.ts';
import { getVariant, listVariants } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import {
  EARLY_DRAW_PLIES,
  TOURNAMENT_MINUTES,
  TOURNAMENT_START_IN,
  TOURNAMENT_TIME_CONTROLS,
  tournamentNameProblem,
} from '../online/tournament.ts';
import type { TournamentList, TournamentSummary, TournamentView } from '../online/tournament.ts';
import { useAccount } from './account.ts';
import { useI18n } from './i18n.tsx';
import { useTournament } from './online/tournamentConnection.ts';
import { ProfileLink } from './ProfileLink.tsx';
import { Crown } from './Punk.tsx';

/** /tournaments: the list and making one. /tournament/<id>: one tournament. */
export function TournamentsPage({
  id,
  onOpen,
  onOpenGame,
}: {
  id: string | null;
  onOpen: (path: string) => void;
  onOpenGame: (gameId: string) => void;
}) {
  return id ? (
    <TournamentRoom key={id} id={id} onOpen={onOpen} onOpenGame={onOpenGame} />
  ) : (
    <TournamentIndex onOpen={onOpen} />
  );
}

/** Ticks every second (for the countdowns). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const clockText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

function Rules() {
  const { t } = useI18n();
  return <p className="muted tournament-rules">{t('tournament.rules', { plies: String(EARLY_DRAW_PLIES / 2) })}</p>;
}

function Chips<T extends string | number | boolean>({
  legend,
  name,
  options,
  value,
  onChange,
  label,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <fieldset className="choice-row choice-grid">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={String(o)} className={`chip${value === o ? ' on' : ''}`}>
          <input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} />
          {label(o)}
        </label>
      ))}
    </fieldset>
  );
}

function TournamentIndex({ onOpen }: { onOpen: (path: string) => void }) {
  const { t, vt } = useI18n();
  const account = useAccount();
  const [list, setList] = useState<TournamentList | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [variantId, setVariantId] = useState(listVariants()[0].id);
  const [timeControlId, setTimeControlId] = useState('3+2');
  const [minutes, setMinutes] = useState<number>(30);
  const [startIn, setStartIn] = useState<number>(5);
  const [rated, setRated] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  useEffect(() => {
    let live = true;
    const ask = () =>
      fetch('/api/tournaments')
        .then((r) => r.json() as Promise<TournamentList>)
        .then((d) => live && setList(d))
        .catch(() => {});
    void ask();
    const timer = setInterval(() => document.visibilityState === 'visible' && void ask(), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const create = async () => {
    if (tournamentNameProblem(name)) return setError('tournament.problem.name');
    setBusy(true);
    setError(null);
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, variantId, timeControlId, minutes, startIn, rated }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (res?.ok && data?.id) return onOpen(`/tournament/${data.id}`);
    setError(
      data?.error === 'one-open'
        ? 'tournament.problem.oneOpen'
        : data?.error === 'name'
          ? 'tournament.problem.name'
          : 'signup.problem.network',
    );
  };

  const row = (s: TournamentSummary) => (
    <li key={s.id}>
      <a
        href={`/tournament/${s.id}`}
        onClick={(e) => {
          e.preventDefault();
          onOpen(`/tournament/${s.id}`);
        }}
      >
        <strong>{s.name}</strong>
        <span className="muted">
          {vt(getVariant(s.variantId)).name} · {timeControl(s.timeControlId).label} ·{' '}
          {t(s.rated ? 'lobby.rated' : 'lobby.casual')}
        </span>
      </a>
      <span className="muted">
        {s.status === 'created'
          ? t('tournament.startsIn', { time: clockText(s.startsAt - now) })
          : s.status === 'started'
            ? t('tournament.endsIn', { time: clockText(s.endsAt - now) })
            : s.winner
              ? `🏆 ${s.winner}`
              : t('tournament.over')}
      </span>
      <span className="tournament-count">👥 {s.players}</span>
    </li>
  );

  return (
    <main className="profile-page tournaments-page">
      <div className="profile-head">
        <div className="profile-title">
          <h1 className="profile-name">{t('tournament.title')}</h1>
          <Rules />
        </div>
      </div>

      {account.user && !making && (
        <button className="primary tournament-make" onClick={() => setMaking(true)}>
          {t('tournament.make')}
        </button>
      )}
      {!account.user && !account.loading && <p className="muted">{t('tournament.signIn')}</p>}
      {making && (
        <form
          className="tournament-form lobby-card online-card"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h2>{t('tournament.make')}</h2>
          <label className="analysis-field">
            <span>{t('tournament.name')}</span>
            <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </label>
          <Chips
            legend={t('newGame.variant')}
            name="t-variant"
            options={listVariants().map((v) => v.id)}
            value={variantId}
            onChange={setVariantId}
            label={(id) => vt(getVariant(id)).name}
          />
          <Chips
            legend={t('newGame.time')}
            name="t-time"
            options={TOURNAMENT_TIME_CONTROLS}
            value={timeControlId}
            onChange={setTimeControlId}
            label={(id) => timeControl(id).label}
          />
          <Chips
            legend={t('tournament.length')}
            name="t-minutes"
            options={TOURNAMENT_MINUTES}
            value={minutes as (typeof TOURNAMENT_MINUTES)[number]}
            onChange={setMinutes}
            label={(m) => t('tournament.minutes', { n: String(m) })}
          />
          <Chips
            legend={t('tournament.startIn')}
            name="t-start"
            options={TOURNAMENT_START_IN}
            value={startIn as (typeof TOURNAMENT_START_IN)[number]}
            onChange={setStartIn}
            label={(m) => t('tournament.minutes', { n: String(m) })}
          />
          <Chips
            legend={t('lobby.kind')}
            name="t-rated"
            options={[true, false] as const}
            value={rated}
            onChange={setRated}
            label={(r) => t(r ? 'lobby.rated' : 'lobby.casual')}
          />
          {error && <p className="error">{t(error)}</p>}
          <div className="lobby-actions pair">
            <button type="button" onClick={() => setMaking(false)}>
              {t('settings.back')}
            </button>
            <button className="primary analysis-go" type="submit" disabled={busy}>
              {t('tournament.makeButton')}
            </button>
          </div>
        </form>
      )}

      {!list && <p className="muted">{t('leaders.loading')}</p>}
      {list && list.live.length + list.upcoming.length + list.finished.length === 0 && (
        <p className="muted">{t('tournament.none')}</p>
      )}
      {list &&
        (
          [
            ['tournament.live', list.live],
            ['tournament.upcoming', list.upcoming],
            ['tournament.finished', list.finished],
          ] as const
        ).map(
          ([title, items]) =>
            items.length > 0 && (
              <section key={title} className="tournament-section">
                <h2>{t(title)}</h2>
                <ul className="tournament-list">{items.map(row)}</ul>
              </section>
            ),
        )}
    </main>
  );
}

function TournamentRoom({
  id,
  onOpen,
  onOpenGame,
}: {
  id: string;
  onOpen: (path: string) => void;
  onOpenGame: (gameId: string) => void;
}) {
  const { t, vt } = useI18n();
  const account = useAccount();
  const link = useTournament(id, (ticket) => onOpenGame(ticket.gameId));
  const now = useNow() + link.skew;
  const [copied, setCopied] = useState(false);
  const v: TournamentView | null = link.view;

  if (link.status === 'missing') {
    return (
      <main className="profile-page">
        <p className="muted">{t('tournament.missing')}</p>
      </main>
    );
  }
  if (!v) {
    return (
      <main className="profile-page">
        <p className="muted">{t('leaders.loading')}</p>
      </main>
    );
  }
  const me = v.standings.find((p) => p.userId === v.you) ?? null;
  // The top three once they have points: patches on the jacket, the winner's in the middle.
  const podium = v.standings.filter((p) => p.score > 0).slice(0, 3);

  return (
    <main className="tournament-page">
      <header className="tz-head">
        <div className="tz-badge" aria-hidden="true">
          <Crown />
        </div>
        <div className="tz-title">
          <p className="tz-meta">
            {vt(getVariant(v.variantId)).name} · {timeControl(v.timeControlId).label} ·{' '}
            {t(v.rated ? 'lobby.rated' : 'lobby.casual')}
          </p>
          <RansomTitle text={v.name} />
          <p className="tz-sub">
            {t('tournament.by', { name: v.createdBy })} · {t('tournament.playersN', { n: String(v.standings.length) })}{' '}
            · {t('tournament.games', { n: String(v.games) })} ·{' '}
            <a
              href="/tournaments"
              onClick={(e) => {
                e.preventDefault();
                onOpen('/tournaments');
              }}
            >
              {t('tournament.all')}
            </a>
          </p>
        </div>
        <div className={`tz-clock ${v.status}`}>
          <small>
            {v.status === 'created'
              ? t('tournament.startsInLabel')
              : v.status === 'started'
                ? t('tournament.endsInLabel')
                : t('tournament.over')}
          </small>
          <span>
            {v.status === 'created'
              ? clockText(v.startsAt - now)
              : v.status === 'started'
                ? clockText(v.endsAt - now)
                : '—'}
          </span>
        </div>
      </header>

      <div className="tz-bar">
        {v.status !== 'finished' && account.user && (
          <>
            {!me || me.paused ? (
              <button className="tz-pill primary" onClick={link.join} disabled={link.status !== 'open'}>
                {me ? t('tournament.resume') : t('tournament.join')}
              </button>
            ) : (
              <button className="tz-pill" onClick={link.withdraw} disabled={link.status !== 'open'}>
                {v.status === 'created' ? t('tournament.withdraw') : t('tournament.pause')}
              </button>
            )}
            {me?.game ? (
              <button className="tz-pill primary" onClick={() => onOpenGame(me.game!)}>
                {t('tournament.backToGame')}
              </button>
            ) : me && !me.paused && v.status === 'started' ? (
              <span className="tournament-waiting">{t('tournament.waiting')}</span>
            ) : me && !me.paused && v.status === 'created' ? (
              <span className="muted">{t('tournament.joined')}</span>
            ) : null}
          </>
        )}
        {v.status !== 'finished' && !account.user && !account.loading && (
          <span className="muted">{t('tournament.signIn')}</span>
        )}
        <button
          className="tz-pill ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(`${location.origin}/tournament/${v.id}`).then(() => setCopied(true));
          }}
        >
          {copied ? t('gang.copied') : t('tournament.copyLink')}
        </button>
      </div>
      {link.error && <p className="error">{t(`tournament.error.${link.error}`)}</p>}

      {podium.length > 0 && (
        <ol className="tz-podium" aria-label={t('tournament.podium')}>
          {podium.map((p, i) => (
            <li key={p.userId} className={`tz-patch place-${i + 1}`}>
              {i === 0 ? <Crown /> : <span className="tz-roman">{i === 1 ? 'II' : 'III'}</span>}
              <ProfileLink username={p.username}>{p.username}</ProfileLink>
              <strong>{t('tournament.points', { n: String(p.score) })}</strong>
              {i === 0 && p.fire && (
                <span className="tz-fire-tag">
                  <Flame />
                  {t('tournament.fireTag')}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <ol className="tz-standings">
        {v.standings.length === 0 && <li className="tz-empty muted">{t('tournament.nobody')}</li>}
        {v.standings.map((p, i) => (
          <li
            key={p.userId}
            className={`tz-row${i === 0 && p.score > 0 ? ' lead' : ''}${p.userId === v.you ? ' mine' : ''}${p.paused ? ' paused' : ''}`}
          >
            <span className="tz-place">{i + 1}</span>
            <span className="tz-player">
              <ProfileLink username={p.username}>{p.username}</ProfileLink>
              {p.fire && (
                <span className="tz-fire" title={t('tournament.onFire')}>
                  <Flame />
                </span>
              )}
              {p.game && <span className="tournament-playing" title={t('tournament.playing')} />}
              {p.paused && <span className="tz-paused">{t('tournament.paused')}</span>}
            </span>
            <span className="tz-sheet" aria-label={t('tournament.sheet')}>
              {p.sheet.slice(-12).map((s) => (
                <a
                  key={s.gameId}
                  href={`/${s.gameId}`}
                  className={`tz-dot ${s.r}${s.fire ? ' fire' : ''}`}
                  title={t(`tournament.result.${s.r}`)}
                >
                  {s.pts}
                </a>
              ))}
            </span>
            <span className="tz-score">{p.score}</span>
          </li>
        ))}
      </ol>
      <Rules />
    </main>
  );
}

const Flame = () => (
  <svg className="tz-flame" viewBox="0 0 24 28" aria-hidden="true">
    <path d="M12 2c1 5 6 7 6 14a6 6 0 0 1-12 0c0-3 1.5-5 3-6.5 0 2.5 1 4 2.5 4.5C11 10 10 6 12 2z" />
  </svg>
);

/**
 * The tournament's name as a ransom note: each letter cut from something
 * else (seven looks in turn), spaces kept as gaps. Read out as the plain name.
 */
function RansomTitle({ text }: { text: string }) {
  // Words stay whole when the line breaks.
  const words = text.toLocaleUpperCase('tr').split(/\s+/).filter(Boolean);
  let n = 0;
  return (
    <h1 className="tz-ransom" aria-label={text}>
      {words.map((word, w) => (
        <span key={w} className="tz-word" aria-hidden="true">
          {[...word].map((ch, i) => (
            <span key={i} className={`tz-cut c${n++ % 7}`}>
              {ch}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}
