// Challenges from a profile (migrations/0008_challenges.sql):
//
//   POST /api/challenges { to, gameId, … }      the signed-in player challenges `to` to a game they made
//   GET  /api/challenges                        open challenges to the signed-in player
//   POST /api/challenges/:id/accept|decline     the challenged player answers
//
// The game itself is an ordinary online game made by the challenger (its link
// works for anyone); the challenge only tells one player about it.

import { CHALLENGE_TTL_MS } from '../src/online/challenge.ts';
import type { Challenge, ChallengeList } from '../src/online/challenge.ts';
import { GAME_ID } from '../src/online/protocol.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Answers a challenge request, or returns null when `url` is not one. */
export async function handleChallenges(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const m = /^\/api\/challenges(?:\/([A-Za-z0-9-]{8,40})\/(accept|decline))?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return json({ error: 'signed-out' }, 401);
  const now = Date.now();

  if (!m[1] && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT c.id, u.username AS from_name, c.game_id, c.variant_id, c.time_control, c.rated, c.created_at
       FROM challenges c JOIN users u ON u.id = c.from_user
       WHERE c.to_user = ?1 AND c.status = 'open' AND c.created_at > ?2
       ORDER BY c.created_at DESC LIMIT 5`,
    )
      .bind(user.id, now - CHALLENGE_TTL_MS)
      .all<{
        id: string;
        from_name: string;
        game_id: string;
        variant_id: string;
        time_control: string;
        rated: number;
        created_at: number;
      }>();
    const challenges: Challenge[] = rows.results.map((r) => ({
      id: r.id,
      from: r.from_name,
      gameId: r.game_id,
      variantId: r.variant_id,
      timeControlId: r.time_control,
      rated: r.rated === 1,
      createdAt: r.created_at,
    }));
    return json({ challenges } satisfies ChallengeList);
  }

  if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);

  if (m[1]) {
    const status = m[2] === 'accept' ? 'accepted' : 'declined';
    const res = await env.DB.prepare(
      "UPDATE challenges SET status = ?1 WHERE id = ?2 AND to_user = ?3 AND status = 'open'",
    )
      .bind(status, m[1], user.id)
      .run();
    return json({ ok: (res.meta.changes ?? 0) > 0 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof body.to === 'string' ? body.to : '';
  const gameId = typeof body.gameId === 'string' ? body.gameId : '';
  const variantId = typeof body.variantId === 'string' ? body.variantId.slice(0, 40) : '';
  const timeControlId = typeof body.timeControlId === 'string' ? body.timeControlId.slice(0, 20) : '';
  if (!to || !GAME_ID.test(gameId) || !variantId || !timeControlId) return json({ error: 'bad-request' }, 400);
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(to).first<{ id: string }>();
  if (!target) return json({ error: 'not-found' }, 404);
  if (target.id === user.id) return json({ error: 'bad-request' }, 400);
  // One open challenge per pair: a new one replaces the old.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE challenges SET status = 'declined' WHERE from_user = ?1 AND to_user = ?2 AND status = 'open'",
    ).bind(user.id, target.id),
    env.DB.prepare(
      `INSERT INTO challenges (id, from_user, to_user, game_id, variant_id, time_control, rated, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', ?8)`,
    ).bind(crypto.randomUUID(), user.id, target.id, gameId, variantId, timeControlId, body.rated === true ? 1 : 0, now),
  ]);
  return json({ ok: true });
}
