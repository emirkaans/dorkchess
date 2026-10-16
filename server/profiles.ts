// Public profiles: a player's ratings, rating history and finished games (D1).
//
//   GET /api/users/:username                       the profile and ratings
//   GET /api/users/:username/games?before=<ms>     finished games, newest first (20 a page)
//   GET /api/users/:username/history?category=…    rating after each rated game of a category
//   POST /api/me/jacket { jacket }                 the signed-in player picks a jacket they have earned
//   POST /api/me/tag { tag }                       … and a spray tag style

import { PROVISIONAL_RD } from '../src/rating/glicko2.ts';
import type { ProfileGame, ProfileRating, ProfileResponse, RatingPoint, Rival } from '../src/online/profile.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';
import { JACKETS, jacketById, jacketOpen, longestRun } from '../src/achievements/jackets.ts';
import type { JacketStats } from '../src/achievements/jackets.ts';
import { TAG_STYLES, tagById, tagOpen } from '../src/achievements/tags.ts';

const PAGE = 20;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** What earns the jackets: patches, games, the best settled rating, Puzzle Rush, daily puzzles. */
async function jacketStats(db: D1Database, userId: string): Promise<JacketStats> {
  const [patches, games, rating, rush, daily, mates] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM user_patches WHERE user_id = ?1').bind(userId),
    db
      .prepare("SELECT count(*) AS n FROM games WHERE (white_user = ?1 OR black_user = ?1) AND result != '*'")
      .bind(userId),
    db
      .prepare("SELECT max(rating) AS r FROM ratings WHERE user_id = ?1 AND category != 'puzzle' AND rd <= ?2")
      .bind(userId, PROVISIONAL_RD),
    db.prepare('SELECT best FROM rush_scores WHERE user_id = ?1').bind(userId),
    db.prepare('SELECT day FROM daily_results WHERE user_id = ?1 AND solved = 1').bind(userId),
    db
      .prepare(
        `SELECT count(*) AS n FROM games WHERE termination = 'checkmate' AND
           ((white_user = ?1 AND result = '1-0') OR (black_user = ?1 AND result = '0-1'))`,
      )
      .bind(userId),
  ]);
  const first = <T>(r: D1Result) => r.results[0] as T | undefined;
  const best = first<{ r: number | null }>(rating)?.r;
  return {
    patches: first<{ n: number }>(patches)?.n ?? 0,
    games: first<{ n: number }>(games)?.n ?? 0,
    bestRating: best == null ? null : Math.round(best),
    rushBest: first<{ best: number }>(rush)?.best ?? 0,
    dailyBest: longestRun((daily.results as { day: string }[]).map((d) => d.day)),
    mates: first<{ n: number }>(mates)?.n ?? 0,
  };
}

/**
 * Rivals: per opponent with an account, the player's wins, losses and draws;
 * the nemesis has beaten the player most (and more often than lost to them),
 * the victim lost to them most (and more often than won).
 */
async function rivals(db: D1Database, userId: string): Promise<{ nemesis: Rival | null; victim: Rival | null }> {
  const rows = await db
    .prepare(
      `SELECT u.username, SUM(r.won) AS wins, SUM(r.lost) AS losses, SUM(r.drawn) AS draws FROM (
         SELECT black_user AS opp, result = '1-0' AS won, result = '0-1' AS lost, result = '1/2-1/2' AS drawn
           FROM games WHERE white_user = ?1 AND black_user IS NOT NULL AND result != '*'
         UNION ALL
         SELECT white_user, result = '0-1', result = '1-0', result = '1/2-1/2'
           FROM games WHERE black_user = ?1 AND white_user IS NOT NULL AND result != '*'
       ) r JOIN users u ON u.id = r.opp
       GROUP BY r.opp`,
    )
    .bind(userId)
    .all<{ username: string; wins: number; losses: number; draws: number }>();
  const list: Rival[] = rows.results.map((r) => ({
    username: r.username,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
  }));
  // The nemesis leads the head-to-head against the player, the victim trails it.
  const pick = (key: 'wins' | 'losses') =>
    list
      .filter((r) => r[key] > (key === 'wins' ? r.losses : r.wins))
      .sort((a, b) => b[key] - a[key] || b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws))[0] ?? null;
  return { nemesis: pick('losses'), victim: pick('wins') };
}

/** How many follow the player and whom they follow, and whether the viewer is one of the first. */
async function followInfo(db: D1Database, userId: string, request: Request, env: AuthEnv) {
  const viewer = await currentUser(request, env).catch(() => null);
  const [followers, following, mine] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM follows WHERE followee = ?1').bind(userId),
    db.prepare('SELECT count(*) AS n FROM follows WHERE follower = ?1').bind(userId),
    db.prepare('SELECT 1 AS x FROM follows WHERE follower = ?1 AND followee = ?2').bind(viewer?.id ?? '', userId),
  ]);
  const n = (r: D1Result) => (r.results[0] as { n: number } | undefined)?.n ?? 0;
  return { followers: n(followers), following: n(following), followed: !!viewer && mine.results.length > 0 };
}

/** Answers a profile request, or returns null when `url` is not one. */
export async function handleProfiles(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/me/tag' && request.method === 'POST') {
    if (!env.DB) return json({ error: 'accounts-off' }, 503);
    if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    const body = (await request.json().catch(() => ({}))) as { tag?: unknown };
    const style = TAG_STYLES.find((s) => s.id === body.tag);
    if (!style) return json({ error: 'not-found' }, 404);
    if (!tagOpen(style, await jacketStats(env.DB, user.id))) return json({ error: 'locked' }, 403);
    await env.DB.prepare('UPDATE users SET tag = ?1 WHERE id = ?2').bind(style.id, user.id).run();
    return json({ tag: style.id });
  }
  if (url.pathname === '/api/me/jacket' && request.method === 'POST') {
    if (!env.DB) return json({ error: 'accounts-off' }, 503);
    if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    const body = (await request.json().catch(() => ({}))) as { jacket?: unknown };
    const jacket = JACKETS.find((j) => j.id === body.jacket);
    if (!jacket) return json({ error: 'not-found' }, 404);
    if (!jacketOpen(jacket, await jacketStats(env.DB, user.id))) return json({ error: 'locked' }, 403);
    await env.DB.prepare('UPDATE users SET jacket = ?1 WHERE id = ?2').bind(jacket.id, user.id).run();
    return json({ jacket: jacket.id });
  }
  if (url.pathname === '/api/users' && request.method === 'GET') {
    // Players by the start of their username (the top bar's search); suspended ones are left out.
    if (!env.DB) return json([]);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 20);
    if (q.length < 2 || !/^[A-Za-z0-9_-]+$/.test(q)) return json([]);
    const rows = await env.DB.prepare(
      `SELECT username FROM users WHERE username LIKE ?1 ESCAPE '\\' AND banned_at IS NULL
       ORDER BY length(username), username LIMIT 10`,
    )
      .bind(`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      .all<{ username: string }>();
    return json(rows.results);
  }
  const m = /^\/api\/users\/([^/]+)(?:\/(games|history))?$/.exec(url.pathname);
  if (!m || request.method !== 'GET') return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const user = await env.DB.prepare(
    'SELECT id, username, created_at, jacket, tag FROM users WHERE username = ?1 AND banned_at IS NULL',
  )
    .bind(decodeURIComponent(m[1]))
    .first<{ id: string; username: string; created_at: number; jacket: string | null; tag: string | null }>();
  if (!user) return json({ error: 'not-found' }, 404);

  if (!m[2]) {
    const rows = await env.DB.prepare(
      'SELECT category, rating, rd, games, wins, losses, draws FROM ratings WHERE user_id = ?1',
    )
      .bind(user.id)
      .all<{
        category: string;
        rating: number;
        rd: number;
        games: number;
        wins: number;
        losses: number;
        draws: number;
      }>();
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM games WHERE (white_user = ?1 OR black_user = ?1) AND result != '*'",
    )
      .bind(user.id)
      .first<{ n: number }>();
    const patches = await env.DB.prepare(
      'SELECT patch_id, earned_at FROM user_patches WHERE user_id = ?1 ORDER BY earned_at ASC',
    )
      .bind(user.id)
      .all<{ patch_id: string; earned_at: number }>();
    const ratings: ProfileRating[] = rows.results.map((r) => ({
      category: r.category,
      rating: Math.round(r.rating),
      provisional: r.rd > PROVISIONAL_RD,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
    }));
    return json({
      username: user.username,
      createdAt: user.created_at,
      games: count?.n ?? 0,
      ratings,
      patches: patches.results.map((p) => ({ id: p.patch_id, earnedAt: p.earned_at })),
      ...(await followInfo(env.DB, user.id, request, env)),
      ...(await rivals(env.DB, user.id)),
      gang:
        (await env.DB.prepare(
          'SELECT g.tag, g.name FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE m.user_id = ?1',
        )
          .bind(user.id)
          .first<{ tag: string; name: string }>()) ?? null,
      jacket: jacketById(user.jacket).id,
      tag: tagById(user.tag).id,
      stats: await jacketStats(env.DB, user.id),
    } satisfies ProfileResponse);
  }

  if (m[2] === 'games') {
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = await env.DB.prepare(
      `SELECT id, variant_id, time_control, rated, white_user, white_name, black_name, white_rating, black_rating,
              white_diff, black_diff, result, termination, ended_at,
              (SELECT username FROM users WHERE id = games.white_user) AS white_username,
              (SELECT username FROM users WHERE id = games.black_user) AS black_username
       FROM games WHERE (white_user = ?1 OR black_user = ?1) AND ended_at < ?2
       ORDER BY ended_at DESC LIMIT ?3`,
    )
      .bind(user.id, before, PAGE + 1)
      .all<{
        id: string;
        variant_id: string;
        time_control: string;
        rated: number;
        white_user: string | null;
        white_name: string;
        black_name: string;
        white_rating: number | null;
        black_rating: number | null;
        white_diff: number | null;
        black_diff: number | null;
        result: string;
        termination: string;
        ended_at: number;
        white_username: string | null;
        black_username: string | null;
      }>();
    const games: ProfileGame[] = rows.results.slice(0, PAGE).map((g) => {
      const white = g.white_user === user.id;
      return {
        id: g.id,
        variantId: g.variant_id,
        timeControlId: g.time_control,
        rated: g.rated === 1,
        color: white ? 'w' : 'b',
        opponent: white ? g.black_name : g.white_name,
        opponentUsername: white ? g.black_username : g.white_username,
        opponentRating: white ? g.black_rating : g.white_rating,
        rating: white ? g.white_rating : g.black_rating,
        diff: white ? g.white_diff : g.black_diff,
        result: g.result,
        termination: g.termination,
        endedAt: g.ended_at,
      };
    });
    return json({ games, more: rows.results.length > PAGE });
  }

  // History: the rating after each rated game of one category, oldest first.
  const category = url.searchParams.get('category') ?? '';
  const rows = await env.DB.prepare(
    `SELECT ended_at,
            CASE WHEN white_user = ?1 THEN white_rating ELSE black_rating END AS before,
            CASE WHEN white_user = ?1 THEN white_rating + white_diff ELSE black_rating + black_diff END AS after
     FROM games WHERE (white_user = ?1 OR black_user = ?1) AND rated = 1 AND category = ?2
     ORDER BY ended_at ASC LIMIT 1000`,
  )
    .bind(user.id, category)
    .all<{ ended_at: number; before: number; after: number }>();
  const points: RatingPoint[] = rows.results.map((r) => ({ at: r.ended_at, rating: r.after }));
  // The graph starts from the rating before the first game.
  if (rows.results.length) points.unshift({ at: rows.results[0].ended_at - 1, rating: rows.results[0].before });
  return json({ points });
}
