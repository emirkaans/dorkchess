// Following players (migrations/0009_follows.sql):
//
//   POST   /api/follows/:username   the signed-in player follows them
//   DELETE /api/follows/:username   … stops following
//   GET    /api/follows             the followed players and what they are doing now
//
// "What they are doing" comes from the lobby (Durable Object): who is in it,
// and who is playing which game.

import { MAX_FOLLOWING, sortFollowing } from '../src/online/follow.ts';
import type { FollowStatus, FollowingResponse, Presence } from '../src/online/follow.ts';
import type { Env } from './game-room.ts';
import { currentUser, sameOrigin } from './auth.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Answers a follow request, or returns null when `url` is not one. */
export async function handleFollows(request: Request, env: Env, url: URL): Promise<Response | null> {
  const m = /^\/api\/follows(?:\/([A-Za-z][A-Za-z0-9_-]{2,19}))?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return json({ error: 'signed-out' }, 401);

  if (!m[1] && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT u.username FROM follows f JOIN users u ON u.id = f.followee WHERE f.follower = ?1 LIMIT ?2`,
    )
      .bind(user.id, MAX_FOLLOWING)
      .all<{ username: string }>();
    const names = rows.results.map((r) => r.username);
    let presence: Presence = { lobby: [], games: {} };
    if (names.length) {
      const res = await env.LOBBY.get(env.LOBBY.idFromName('main'))
        .fetch('https://lobby/presence', { method: 'POST', body: JSON.stringify({ names }) })
        .catch(() => null);
      if (res?.ok) presence = (await res.json()) as Presence;
    }
    const inLobby = new Set(presence.lobby);
    const following: FollowStatus[] = names.map((username) => {
      const gameId = presence.games[username] ?? null;
      return { username, gameId, status: gameId ? 'playing' : inLobby.has(username) ? 'lobby' : 'offline' };
    });
    return json({ following: sortFollowing(following) } satisfies FollowingResponse);
  }

  if (!m[1] || (request.method !== 'POST' && request.method !== 'DELETE')) return json({ error: 'not-found' }, 404);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
  const target = await env.DB.prepare('SELECT id FROM users WHERE username = ?1').bind(m[1]).first<{ id: string }>();
  if (!target) return json({ error: 'not-found' }, 404);
  if (target.id === user.id) return json({ error: 'bad-request' }, 400);
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM follows WHERE follower = ?1 AND followee = ?2').bind(user.id, target.id).run();
    return json({ following: false });
  }
  const count = await env.DB.prepare('SELECT count(*) AS n FROM follows WHERE follower = ?1')
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FOLLOWING) return json({ error: 'too-many' }, 400);
  await env.DB.prepare('INSERT OR IGNORE INTO follows (follower, followee, created_at) VALUES (?1, ?2, ?3)')
    .bind(user.id, target.id, Date.now())
    .run();
  return json({ following: true });
}
