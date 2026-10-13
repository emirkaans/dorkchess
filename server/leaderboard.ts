// The leaderboard:
//
//   GET /api/leaderboard                    the top players of every category
//   GET /api/leaderboard?category=blitz     one category, further down
//
// Players with a settled rating come first, then provisional ones (marked
// with '?'); players inactive for a while are left out.

import { PROVISIONAL_RD } from '../src/rating/glicko2.ts';
import { allCategories } from '../src/rating/categories.ts';
import { LEADERS_ACTIVE_DAYS, LEADERS_PAGE, LEADERS_TOP } from '../src/online/leaderboard.ts';
import type { LeaderCategory, LeaderEntry, LeaderboardResponse } from '../src/online/leaderboard.ts';
import type { AuthEnv } from './auth.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    // A minute old is fresh enough, and spares the database.
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });

interface Row {
  category: string;
  username: string;
  rating: number;
  rd: number;
  games: number;
}

const entry = (r: Row): LeaderEntry => ({
  username: r.username,
  rating: Math.round(r.rating),
  provisional: r.rd > PROVISIONAL_RD,
  games: r.games,
});

/** Answers a leaderboard request, or returns null when `url` is not one. */
export async function handleLeaderboard(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/leaderboard' || request.method !== 'GET') return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const categories: string[] = [...allCategories(), 'puzzle'];
  const asked = url.searchParams.get('category');
  if (asked !== null && !categories.includes(asked)) return json({ error: 'not-found' }, 404);
  const since = Date.now() - LEADERS_ACTIVE_DAYS * 86_400_000;
  const order = `(r.rd > ${PROVISIONAL_RD}), r.rating DESC`;

  if (asked) {
    const rows = await env.DB.prepare(
      `SELECT r.category, u.username, r.rating, r.rd, r.games FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.category = ?1 AND r.games > 0 AND r.updated_at >= ?2
       ORDER BY ${order} LIMIT ?3`,
    )
      .bind(asked, since, LEADERS_PAGE)
      .all<Row>();
    return json({ categories: [{ category: asked, players: rows.results.map(entry) }] } satisfies LeaderboardResponse);
  }

  const rows = await env.DB.prepare(
    `SELECT category, username, rating, rd, games FROM (
       SELECT r.category, u.username, r.rating, r.rd, r.games,
              ROW_NUMBER() OVER (PARTITION BY r.category ORDER BY ${order}) AS place
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.games > 0 AND r.updated_at >= ?1)
     WHERE place <= ?2 ORDER BY category, place`,
  )
    .bind(since, LEADERS_TOP)
    .all<Row>();
  const by = new Map<string, LeaderEntry[]>(categories.map((c) => [c, []]));
  for (const r of rows.results) by.get(r.category)?.push(entry(r));
  const result: LeaderCategory[] = categories.map((category) => ({ category, players: by.get(category) ?? [] }));
  return json({ categories: result } satisfies LeaderboardResponse);
}
