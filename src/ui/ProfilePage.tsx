import { useEffect, useState } from 'react';
import { timeControl } from '../clock/clock.ts';
import { getVariant, listVariants } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { outcomeFor } from '../online/profile.ts';
import type { ProfileGame, ProfileRating, ProfileResponse, RatingPoint } from '../online/profile.ts';
import type { FollowLists } from '../online/follow.ts';
import { allCategories, variantOfCategory } from '../rating/categories.ts';
import { useI18n } from './i18n.tsx';
import { BattleJacket, jacketSrc } from './BattleJacket.tsx';
import { useAccount } from './account.ts';
import { AccountSettings } from './AccountSettings.tsx';
import { JacketWindow } from './JacketWindow.tsx';
import { Modal } from './Modal.tsx';
import { SprayPlayer, SprayStill } from './SprayTag.tsx';
import { TAG_STYLES, tagById, tagOpen } from '../achievements/tags.ts';
import { loadPrefs } from './prefs.ts';
import { progress } from '../achievements/jackets.ts';
import { ProfileLink } from './ProfileLink.tsx';
import { FriendGame } from './online/LobbyPage.tsx';
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
  // Account settings (deleting the account) open from the foot of the player's own profile.
  const [showAccount, setShowAccount] = useState(false);
  // Whom the challenge window challenges (this profile's player, or one's nemesis), or null.
  const [challenging, setChallenging] = useState<string | null>(null);
  // The big jacket with every patch opens in a window; the page shows it small.
  const [showJacket, setShowJacket] = useState(false);
  const account = useAccount();
  // Own profile: the spray tag picker is open.
  const [pickingTag, setPickingTag] = useState(false);
  // Own profile: the followers or following list being shown.
  const [followList, setFollowList] = useState<'followers' | 'following' | null>(null);

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

  const mine = !!account.user && typeof profile === 'object' && profile?.username === account.user.username;
  const toggleFollow = async () => {
    if (!profile || typeof profile !== 'object') return;
    const on = !profile.followed;
    const res = await fetch(`/api/follows/${encodeURIComponent(profile.username)}`, {
      method: on ? 'POST' : 'DELETE',
      credentials: 'same-origin',
    }).catch(() => null);
    if (!res?.ok) return;
    setProfile((p) =>
      p && typeof p === 'object' ? { ...p, followed: on, followers: Math.max(0, p.followers + (on ? 1 : -1)) } : p,
    );
  };
  const pickJacket = async (id: string) => {
    const res = await fetch('/api/me/jacket', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jacket: id }),
    }).catch(() => null);
    if (!res?.ok) return;
    setProfile((p) => (p && typeof p === 'object' ? { ...p, jacket: id } : p));
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
  // Without a category picked: game results only (puzzles are solved or missed, not won).
  const totals = profile.ratings
    .filter((r) => r.category !== 'puzzle')
    .reduce((s, r) => ({ wins: s.wins + r.wins, losses: s.losses + r.losses, draws: s.draws + r.draws }), {
      wins: 0,
      losses: 0,
      draws: 0,
    });
  const stats = selected ?? totals;
  const played = stats.wins + stats.losses + stats.draws;

  return (
    <main className="profile-page">
      <header className="profile-head">
        <button
          className="jacket-thumb"
          onClick={() => setShowJacket(true)}
          aria-label={t('jacket.open', { n: String(profile.patches.length) })}
        >
          <BattleJacket
            username={profile.username}
            jacket={profile.jacket}
            patches={profile.patches.map((p) => p.id)}
          />
          <span className="jacket-thumb-count">
            {profile.patches.length}/{PATCHES.length}
          </span>
        </button>
        <div className="profile-title">
          <h1 className="profile-name">{profile.username}</h1>
          {profile.gang && (
            <a
              className="gang-badge"
              href={`/gang/${profile.gang.tag}`}
              onClick={(e) => {
                e.preventDefault();
                onOpen(`/gang/${profile.gang!.tag}`);
              }}
            >
              [{profile.gang.tag}] {profile.gang.name}
            </a>
          )}
          <p className="muted profile-follows">
            {mine ? (
              <>
                <button className="link-button" onClick={() => setFollowList('followers')}>
                  {t('follow.followers', { n: String(profile.followers) })}
                </button>{' '}
                ·{' '}
                <button className="link-button" onClick={() => setFollowList('following')}>
                  {t('follow.following', { n: String(profile.following) })}
                </button>
              </>
            ) : (
              <>
                {t('follow.followers', { n: String(profile.followers) })} ·{' '}
                {t('follow.following', { n: String(profile.following) })}
              </>
            )}
          </p>
          {followList && (
            <FollowListDialog
              which={followList}
              onClose={() => setFollowList(null)}
              onOpen={(path) => {
                setFollowList(null);
                onOpen(path);
              }}
            />
          )}
          {account.user && !mine && (
            <div className="profile-actions">
              <button className="primary challenge-button" onClick={() => setChallenging(profile.username)}>
                {t('challenge.button')}
              </button>
              <button className={`follow-button${profile.followed ? ' on' : ''}`} onClick={() => void toggleFollow()}>
                {profile.followed ? t('follow.unfollow') : t('follow.follow')}
              </button>
            </div>
          )}
          <p className="muted">
            {t('profile.joined', { date: date(profile.createdAt) })} ·{' '}
            {t('profile.games', { n: String(profile.games) })}
          </p>
        </div>
      </header>

      {showJacket && (
        <JacketWindow
          profile={profile}
          mine={mine}
          date={date}
          onPick={pickJacket}
          onShare={(svg) => shareJacket(svg, profile.jacket, profile.username, t('jacket.shareText'))}
          onClose={() => setShowJacket(false)}
        />
      )}
      {challenging && (
        <Modal label={t('challenge.button')} className="challenge-modal" onClose={() => setChallenging(null)}>
          <h2>{t('challenge.title')}</h2>
          <FriendGame
            challenge={challenging}
            defaultVariantId={listVariants()[0].id}
            onOpenGame={(id) => {
              setChallenging(null);
              onOpen(`/${id}`);
            }}
          />
        </Modal>
      )}
      {showAccount && <AccountSettings username={profile.username} onClose={() => setShowAccount(false)} />}

      {(profile.nemesis || profile.victim) && (
        <section className="rivals" aria-label={t('rival.title')}>
          {profile.nemesis && (
            <div className="rival nemesis">
              <span className="rival-kind">☠ {t('rival.nemesis')}</span>
              <ProfileLink username={profile.nemesis.username}>{profile.nemesis.username}</ProfileLink>
              <span className="rival-record">
                {t('rival.record', {
                  w: String(profile.nemesis.wins),
                  l: String(profile.nemesis.losses),
                  d: String(profile.nemesis.draws),
                })}
              </span>
              {mine && (
                <button className="primary" onClick={() => setChallenging(profile.nemesis!.username)}>
                  {t('rival.revenge')}
                </button>
              )}
            </div>
          )}
          {profile.victim && (
            <div className="rival victim">
              <span className="rival-kind">🎯 {t('rival.victim')}</span>
              <ProfileLink username={profile.victim.username}>{profile.victim.username}</ProfileLink>
              <span className="rival-record">
                {t('rival.record', {
                  w: String(profile.victim.wins),
                  l: String(profile.victim.losses),
                  d: String(profile.victim.draws),
                })}
              </span>
            </div>
          )}
        </section>
      )}

      <section className="rating-cards" aria-label={t('profile.ratings')}>
        {[...allCategories(), 'puzzle']
          .filter((c) => c === 'puzzle' || listVariants().some((v) => v.id === (variantOfCategory(c as never) ?? v.id)))
          .map((c) => {
            const r = byCategory.get(c);
            return (
              <button
                key={c}
                className={`rating-card${r ? '' : ' empty'}${category === c ? ' on' : ''}`}
                onClick={() => r && setCategory(c)}
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
            {selected?.category === 'puzzle' ? (
              <>
                <span className="win">{t('profile.solved', { n: String(stats.wins) })}</span>
                <span className="loss">{t('profile.missed', { n: String(stats.losses) })}</span>
              </>
            ) : (
              <>
                <span className="win">{t('profile.wins', { n: String(stats.wins) })}</span>
                <span className="draw">{t('profile.draws', { n: String(stats.draws) })}</span>
                <span className="loss">{t('profile.losses', { n: String(stats.losses) })}</span>
              </>
            )}
          </p>
        </section>
      )}

      <section className="tag-card" aria-label={t(mine ? 'tag.title' : 'tag.theirs')}>
        <span className="tag-card-label">{t(mine ? 'tag.title' : 'tag.theirs')}</span>
        <SprayStill username={profile.username} styleId={profile.tag} className="tag-card-art" />
        {mine && (
          <button className="tz-pill ghost tag-change" onClick={() => setPickingTag(true)}>
            {t('tag.change')}
          </button>
        )}
      </section>
      {pickingTag && (
        <TagPicker
          username={profile.username}
          current={profile.tag}
          stats={profile.stats}
          onClose={() => setPickingTag(false)}
          onPick={async (id) => {
            const res = await fetch('/api/me/tag', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tag: id }),
            }).catch(() => null);
            if (res?.ok) setProfile((p) => (p && typeof p === 'object' ? { ...p, tag: id } : p));
            setPickingTag(false);
          }}
        />
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

      {mine && (
        <footer className="profile-foot">
          <button className="link-button" onClick={() => setShowAccount(true)}>
            {t('account.settings')}
          </button>
        </footer>
      )}
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
async function shareJacket(svg: SVGSVGElement, jacketId: string, username: string, text: string): Promise<void> {
  // The picture first, then the patches over it (a picture inside an SVG drawn as an image does not load).
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  const load = (src: string) =>
    new Promise<HTMLImageElement>((done, fail) => {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => fail(new Error('jacket image'));
      img.src = src;
    });
  try {
    const [picture, img] = await Promise.all([load(jacketSrc(jacketId)), load(url)]);
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
    ctx.drawImage(picture, 60, 180, 960, 960);
    ctx.drawImage(img, 60, 180, 960, 960);
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

/** The signed-in player's own followers or following, from their profile. */
function FollowListDialog({
  which,
  onClose,
  onOpen,
}: {
  which: 'followers' | 'following';
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useI18n();
  const [lists, setLists] = useState<FollowLists | null>(null);
  useEffect(() => {
    fetch('/api/me/follows', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<FollowLists>) : { followers: [], following: [] }))
      .then(setLists)
      .catch(() => setLists({ followers: [], following: [] }));
  }, []);
  const title = t(which === 'followers' ? 'follow.listFollowers' : 'follow.listFollowing');
  const names = lists?.[which] ?? null;
  return (
    <Modal label={title} onClose={onClose} className="player-search">
      <h2>{title}</h2>
      {!names && <p className="muted">{t('leaders.loading')}</p>}
      {names?.length === 0 && <p className="muted">{t('follow.listEmpty')}</p>}
      {names && names.length > 0 && (
        <ul className="player-search-list">
          {names.map((name) => (
            <li key={name}>
              <a
                href={`/@/${name}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(`/@/${name}`);
                }}
              >
                {name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Styles shown per page in the picker. */
const TAGS_PER_PAGE = 6;

/**
 * The spray tag picker: a board to try styles on (each click sprays it again),
 * the styles a page at a time, and the one tried kept with a button.
 */
function TagPicker({
  username,
  current,
  stats,
  onClose,
  onPick,
}: {
  username: string;
  current: string;
  stats: ProfileResponse['stats'];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  const [trying, setTrying] = useState(current);
  const [playKey, setPlayKey] = useState(0);
  const [page, setPage] = useState(
    () => Math.floor(TAG_STYLES.findIndex((s) => s.id === current) / TAGS_PER_PAGE) || 0,
  );
  const pages = Math.ceil(TAG_STYLES.length / TAGS_PER_PAGE);
  const sound = loadPrefs().sound;
  const style = tagById(trying);
  const open = tagOpen(style, stats);
  const lockText = (s: (typeof TAG_STYLES)[number]) =>
    s.need
      ? `${t(`jacket.need.${s.need.kind}`, { n: String(s.need.n) })} (${progress(s.need, stats)}/${s.need.n})`
      : '';
  const tryOut = (id: string) => {
    setTrying(id);
    setPlayKey((k) => k + 1);
  };
  return (
    <Modal label={t('tag.pick')} onClose={onClose} className="tag-picker">
      <h2>{t('tag.pick')}</h2>
      <div className="tag-picker-body">
        <div className="tag-try">
          <div className="tag-stage">
            <SprayPlayer username={username} styleId={trying} playKey={playKey} sound={sound} />
          </div>
          <p className="tag-try-name">
            <strong>{t(`tag.style.${trying}` as MessageKey)}</strong>
            {!open && (
              <span className="tag-lock">
                {' '}
                · {t('tag.locked')} · {lockText(style)}
              </span>
            )}
          </p>
          <div className="tag-try-actions">
            <button className="tz-pill ghost" onClick={() => setPlayKey((k) => k + 1)}>
              {t('tag.again')}
            </button>
            <button className="tz-pill primary" disabled={!open || trying === current} onClick={() => onPick(trying)}>
              {trying === current ? t('tag.mine') : t('tag.use')}
            </button>
          </div>
        </div>
        <div className="tag-list">
          <div className="tag-grid">
            {TAG_STYLES.slice(page * TAGS_PER_PAGE, (page + 1) * TAGS_PER_PAGE).map((s) => {
              const sOpen = tagOpen(s, stats);
              return (
                <button
                  key={s.id}
                  className={`tag-option${s.id === trying ? ' on' : ''}${sOpen ? '' : ' locked'}`}
                  onClick={() => tryOut(s.id)}
                  title={sOpen ? undefined : lockText(s)}
                >
                  <SprayStill username={username} styleId={s.id} className="tag-option-art" />
                  <span className="tag-option-row">
                    <b>{t(`tag.style.${s.id}` as MessageKey)}</b>
                    <small>
                      {s.id === current
                        ? t('tag.mine')
                        : sOpen
                          ? ''
                          : `🔒 ${s.need ? progress(s.need, stats) : 0}/${s.need?.n ?? 0}`}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="tag-pager">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label={t('tag.prev')}>
              ‹
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page === pages - 1}
              aria-label={t('tag.next')}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
