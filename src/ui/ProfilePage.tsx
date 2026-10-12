import { useEffect, useRef, useState } from 'react';
import { timeControl } from '../clock/clock.ts';
import { getVariant, listVariants } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { outcomeFor } from '../online/profile.ts';
import type { ProfileGame, ProfileRating, ProfileResponse, RatingPoint } from '../online/profile.ts';
import { allCategories, variantOfCategory } from '../rating/categories.ts';
import { useI18n } from './i18n.tsx';
import { BattleJacket, PatchMark } from './BattleJacket.tsx';
import { PATCHES } from '../achievements/patches.ts';

interface Props {
  username: string;
  /** Opens a site path (a game, another profile) in the app. */
  onOpen: (path: string) => void;
}

/** /@/<username>: ratings, the rating graph, results and finished games. */
export function ProfilePage({ username, onOpen }: Props) {
  const { t, vt, locale } = useI18n();
  const [profile, setProfile] = useState<ProfileResponse | null | 'missing'>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [games, setGames] = useState<ProfileGame[]>([]);
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState<RatingPoint[]>([]);
  const jacket = useRef<SVGSVGElement>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let live = true;
    setProfile(null);
    setGames([]);
    setCategory(null);
    void (async () => {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`).catch(() => null);
      if (!live) return;
      if (!res?.ok) return setProfile('missing');
      const p = (await res.json()) as ProfileResponse;
      setProfile(p);
      // The category played most opens first.
      const most = [...p.ratings].sort((a, b) => b.games - a.games)[0];
      setCategory(most?.category ?? null);
      const g = (await fetch(`/api/users/${encodeURIComponent(username)}/games`).then((r) => r.json())) as {
        games: ProfileGame[];
        more: boolean;
      };
      if (!live) return;
      setGames(g.games);
      setMore(g.more);
    })();
    return () => {
      live = false;
    };
  }, [username]);

  useEffect(() => {
    if (!category) return setHistory([]);
    let live = true;
    void fetch(`/api/users/${encodeURIComponent(username)}/history?category=${encodeURIComponent(category)}`)
      .then((r) => r.json() as Promise<{ points: RatingPoint[] }>)
      .then((h) => live && setHistory(h.points))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [username, category]);

  const loadMore = async () => {
    const before = games.at(-1)?.endedAt;
    const g = (await fetch(`/api/users/${encodeURIComponent(username)}/games?before=${before}`).then((r) =>
      r.json(),
    )) as { games: ProfileGame[]; more: boolean };
    setGames((old) => [...old, ...g.games]);
    setMore(g.more);
  };

  const categoryName = (c: string) => {
    const v = variantOfCategory(c as never);
    return v ? vt(getVariant(v)).name : t(`rating.${c}` as MessageKey);
  };
  const date = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  if (profile === null) {
    return (
      <main className="profile-page">
        <p className="muted">{t('online.connecting')}</p>
      </main>
    );
  }
  if (profile === 'missing') {
    return (
      <main className="profile-page">
        <h1 className="profile-name">{username}</h1>
        <p className="muted">{t('profile.missing')}</p>
      </main>
    );
  }

  const byCategory = new Map(profile.ratings.map((r) => [r.category, r]));
  const selected: ProfileRating | undefined = category ? byCategory.get(category) : undefined;
  const totals = profile.ratings.reduce(
    (s, r) => ({ wins: s.wins + r.wins, losses: s.losses + r.losses, draws: s.draws + r.draws }),
    { wins: 0, losses: 0, draws: 0 },
  );
  const stats = selected ?? totals;
  const played = stats.wins + stats.losses + stats.draws;

  return (
    <main className="profile-page">
      <header className="profile-head">
        <h1 className="profile-name">{profile.username}</h1>
        <p className="muted">
          {t('profile.joined', { date: date(profile.createdAt) })} · {t('profile.games', { n: String(profile.games) })}
        </p>
      </header>

      <section className="jacket-section" aria-label={t('jacket.title')}>
        <div className="jacket-box">
          <BattleJacket ref={jacket} username={profile.username} patches={profile.patches.map((p) => p.id)} />
          <button
            className="jacket-share"
            disabled={sharing}
            onClick={() => {
              if (!jacket.current) return;
              setSharing(true);
              void shareJacket(jacket.current, profile.username, t('jacket.shareText')).finally(() =>
                setSharing(false),
              );
            }}
          >
            {t('jacket.share')}
          </button>
        </div>
        <div className="patch-list">
          <h2>
            {t('jacket.title')} · {profile.patches.length}/{PATCHES.length}
          </h2>
          <ul>
            {PATCHES.map((patch) => {
              const got = profile.patches.find((p) => p.id === patch.id);
              return (
                <li key={patch.id} className={got ? 'got' : 'locked'}>
                  <svg viewBox="-36 -36 72 72" aria-hidden="true">
                    <PatchMark patch={patch} label={t(`patch.${patch.id}` as MessageKey)} locked={!got} />
                  </svg>
                  <span>
                    <strong>{t(`patch.${patch.id}` as MessageKey)}</strong>
                    <small>{t(`patch.${patch.id}.how` as MessageKey)}</small>
                    {got && <small className="patch-date">{date(got.earnedAt)}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="rating-cards" aria-label={t('profile.ratings')}>
        {[...allCategories(), 'puzzle']
          .filter((c) => c === 'puzzle' || listVariants().some((v) => v.id === (variantOfCategory(c as never) ?? v.id)))
          .map((c) => {
            const r = byCategory.get(c);
            return (
              <button
                key={c}
                className={`rating-card${r ? '' : ' empty'}${category === c ? ' on' : ''}`}
                onClick={() => r && c !== 'puzzle' && setCategory(c)}
                disabled={!r}
                aria-pressed={category === c}
              >
                <span className="rating-cat">{categoryName(c)}</span>
                <span className="rating-num">
                  {r ? r.rating : '—'}
                  {r?.provisional ? '?' : ''}
                </span>
                <span className="rating-games">
                  {t(c === 'puzzle' ? 'profile.puzzlesShort' : 'profile.gamesShort', { n: String(r?.games ?? 0) })}
                </span>
              </button>
            );
          })}
      </section>

      {selected && history.length > 1 && (
        <section
          className="profile-graph"
          aria-label={t('profile.graph', { category: categoryName(selected.category) })}
        >
          <h2>{t('profile.graph', { category: categoryName(selected.category) })}</h2>
          <RatingGraph points={history} />
        </section>
      )}

      {played > 0 && (
        <section className="profile-stats" aria-label={t('profile.results')}>
          <h2>
            {t('profile.results')}
            {selected ? ` · ${categoryName(selected.category)}` : ''}
          </h2>
          <div className="result-bar" aria-hidden="true">
            <span className="win" style={{ flexGrow: stats.wins }} />
            <span className="draw" style={{ flexGrow: stats.draws }} />
            <span className="loss" style={{ flexGrow: stats.losses }} />
          </div>
          <p className="result-legend">
            <span className="win">{t('profile.wins', { n: String(stats.wins) })}</span>
            <span className="draw">{t('profile.draws', { n: String(stats.draws) })}</span>
            <span className="loss">{t('profile.losses', { n: String(stats.losses) })}</span>
          </p>
        </section>
      )}

      <section className="profile-games" aria-label={t('profile.recent')}>
        <h2>{t('profile.recent')}</h2>
        {games.length === 0 && <p className="muted">{t('profile.noGames')}</p>}
        <ul>
          {games.map((g) => {
            const outcome = outcomeFor(g);
            const tc = timeControl(g.timeControlId);
            return (
              <li key={g.id} className={`profile-game ${outcome}`}>
                <button className="game-open" onClick={() => onOpen(`/${g.id}/analysis`)}>
                  <span className={`outcome ${outcome}`}>{t(`profile.${outcome}`)}</span>
                  <span className="game-meta">
                    {vt(getVariant(g.variantId)).name} · {tc.initialMs === null ? t('time.none') : tc.label}
                    {g.rated ? ` · ${t('lobby.rated')}` : ''}
                  </span>
                  <span className="game-date">{date(g.endedAt)}</span>
                </button>
                <span className="game-vs">
                  <span className={`seek-color ${g.color === 'w' ? 'b' : 'w'}`} aria-hidden="true" />
                  {g.opponentUsername ? (
                    <a
                      href={`/@/${g.opponentUsername}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onOpen(`/@/${g.opponentUsername}`);
                      }}
                    >
                      {g.opponent}
                    </a>
                  ) : (
                    g.opponent
                  )}
                  {g.opponentRating !== null && <span className="muted"> ({g.opponentRating})</span>}
                </span>
                {g.diff !== null && (
                  <span className={`game-diff ${g.diff >= 0 ? 'up' : 'down'}`}>
                    {g.diff >= 0 ? '+' : ''}
                    {g.diff}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {more && (
          <button className="profile-more" onClick={() => void loadMore()}>
            {t('profile.more')}
          </button>
        )}
      </section>
    </main>
  );
}

/** Rating after each game, as a line over an area (game number across, rating up). */
function RatingGraph({ points }: { points: readonly RatingPoint[] }) {
  const W = 600;
  const H = 160;
  const pad = 8;
  const ratings = points.map((p) => p.rating);
  const lo = Math.min(...ratings) - 20;
  const hi = Math.max(...ratings) + 20;
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - 2 * pad);
  const y = (r: number) => pad + ((hi - r) / (hi - lo)) * (H - 2 * pad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rating).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const last = points[points.length - 1];
  return (
    <div className="graph-box">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${ratings[0]} → ${last.rating}`}
      >
        <path className="graph-area" d={area} />
        <path className="graph-line" d={line} />
        <circle className="graph-dot" cx={x(points.length - 1)} cy={y(last.rating)} r="4" />
      </svg>
      <span className="graph-hi">{Math.round(hi - 20)}</span>
      <span className="graph-lo">{Math.round(lo + 20)}</span>
    </div>
  );
}

/**
 * The jacket as a picture to post (a story-sized PNG): shared through the
 * phone's share sheet when it can take files, otherwise downloaded.
 */
async function shareJacket(svg: SVGSVGElement, username: string, text: string): Promise<void> {
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((done, fail) => {
      img.onload = () => done();
      img.onerror = () => fail(new Error('jacket image'));
      img.src = url;
    });
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff2e93';
    ctx.font = 'bold 72px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(username, W / 2, 130);
    ctx.drawImage(img, 90, 170, 900, 990);
    ctx.fillStyle = '#c6ff3d';
    ctx.font = 'bold 44px Impact, "Arial Black", sans-serif';
    ctx.fillText('punkchess.com', W / 2, H - 70);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) return;
    const file = new File([blob], `${username}-punkchess.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text }).catch(() => {});
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
