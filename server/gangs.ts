// Gangs (migrations/0010_gangs.sql):
//
//   GET  /api/gangs                 gangs by weekly score, and the signed-in player's gang
//   GET  /api/gangs/:tag            one gang and its members' weekly points
//   POST /api/gangs { name, tag }   the signed-in player founds a gang (and is in it)
//   POST /api/gangs/:tag/join       … joins one (one gang at a time)
//   POST /api/gangs/:tag/leave      … leaves it (the founder's role passes on; an empty gang goes)
//
// The weekly score is worked out when asked: the members' online wins and
// draws and daily puzzles solved in the last week.

import { dailyDay } from '../src/online/daily.ts';
import { GANG_MAX_MEMBERS, GANG_WEEK_DAYS, cleanTag, gangProblem, gangScore } from '../src/online/gang.ts';
import type { GangDetail, GangList, GangMember, GangSummary } from '../src/online/gang.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

interface MemberRow {
  gang_id: string;
  user_id: string;
  username: string;
  wins: number;
  draws: number;
  dailies: number;
}

/** Every member of the given gangs (all gangs when `gangId` is null) with their week's results. */
async function memberRows(db: D1Database, gangId: string | null): Promise<MemberRow[]> {
  const now = Date.now();
  const since = now - GANG_WEEK_DAYS * 86_400_000;
  const rows = await db
    .prepare(
      `SELECT m.gang_id, m.user_id, u.username,
         (SELECT count(*) FROM games g WHERE g.ended_at >= ?2 AND
            ((g.white_user = m.user_id AND g.result = '1-0') OR (g.black_user = m.user_id AND g.result = '0-1'))) AS wins,
         (SELECT count(*) FROM games g WHERE g.ended_at >= ?2 AND g.result = '1/2-1/2' AND
            (g.white_user = m.user_id OR g.black_user = m.user_id)) AS draws,
         (SELECT count(*) FROM daily_results d WHERE d.user_id = m.user_id AND d.solved = 1 AND d.day >= ?3) AS dailies
       FROM gang_members m JOIN users u ON u.id = m.user_id
       WHERE ?1 IS NULL OR m.gang_id = ?1`,
    )
    .bind(gangId, since, dailyDay(since))
    .all<MemberRow>();
  return rows.results;
}

async function myGang(db: D1Database, userId: string) {
  return db
    .prepare('SELECT g.id, g.tag, g.owner FROM gang_members m JOIN gangs g ON g.id = m.gang_id WHERE m.user_id = ?1')
    .bind(userId)
    .first<{ id: string; tag: string; owner: string }>();
}

/** Answers a gang request, or returns null when `url` is not one. */
export async function handleGangs(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const m = /^\/api\/gangs(?:\/([A-Za-z0-9]{2,4})(?:\/(join|leave))?)?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const db = env.DB;
  const user = await currentUser(request, env).catch(() => null);

  if (request.method === 'GET' && !m[1]) {
    const [gangs, members] = await Promise.all([
      db.prepare('SELECT id, tag, name FROM gangs').all<{ id: string; tag: string; name: string }>(),
      memberRows(db, null),
    ]);
    const list: GangSummary[] = gangs.results
      .map((g) => {
        const own = members.filter((r) => r.gang_id === g.id);
        return {
          tag: g.tag,
          name: g.name,
          members: own.length,
          score: own.reduce((s, r) => s + gangScore(r.wins, r.draws, r.dailies), 0),
        };
      })
      .sort((a, b) => b.score - a.score || b.members - a.members || a.tag.localeCompare(b.tag))
      .slice(0, 100);
    const mine = user ? ((await myGang(db, user.id))?.tag ?? null) : null;
    return json({ gangs: list, mine } satisfies GangList);
  }

  if (request.method === 'GET' && m[1] && !m[2]) {
    const g = await db
      .prepare('SELECT id, tag, name, owner, created_at FROM gangs WHERE tag = ?1')
      .bind(cleanTag(m[1]))
      .first<{ id: string; tag: string; name: string; owner: string; created_at: number }>();
    if (!g) return json({ error: 'not-found' }, 404);
    const rows = await memberRows(db, g.id);
    const list: GangMember[] = rows
      .map((r) => ({
        username: r.username,
        score: gangScore(r.wins, r.draws, r.dailies),
        owner: r.user_id === g.owner,
      }))
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
    return json({
      tag: g.tag,
      name: g.name,
      members: list.length,
      score: list.reduce((s, x) => s + x.score, 0),
      createdAt: g.created_at,
      list,
    } satisfies GangDetail);
  }

  if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
  if (!user) return json({ error: 'signed-out' }, 401);
  const now = Date.now();
  const current = await myGang(db, user.id);

  if (!m[1]) {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; tag?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const tag = typeof body.tag === 'string' ? cleanTag(body.tag) : '';
    const problem = gangProblem(name, tag);
    if (problem) return json({ error: problem }, 400);
    if (current) return json({ error: 'in-gang' }, 409);
    const taken = await db.prepare('SELECT 1 FROM gangs WHERE name = ?1 OR tag = ?2').bind(name, tag).first();
    if (taken) return json({ error: 'taken' }, 409);
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare('INSERT INTO gangs (id, name, tag, owner, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(id, name, tag, user.id, now),
      db.prepare('INSERT INTO gang_members (user_id, gang_id, joined_at) VALUES (?1, ?2, ?3)').bind(user.id, id, now),
    ]);
    return json({ tag });
  }

  const g = await db
    .prepare('SELECT id, tag, owner FROM gangs WHERE tag = ?1')
    .bind(cleanTag(m[1]))
    .first<{ id: string; tag: string; owner: string }>();
  if (!g) return json({ error: 'not-found' }, 404);

  if (m[2] === 'join') {
    if (current) return json({ error: current.id === g.id ? 'ok' : 'in-gang' }, current.id === g.id ? 200 : 409);
    const n = await db
      .prepare('SELECT count(*) AS n FROM gang_members WHERE gang_id = ?1')
      .bind(g.id)
      .first<{ n: number }>();
    if ((n?.n ?? 0) >= GANG_MAX_MEMBERS) return json({ error: 'full' }, 409);
    await db
      .prepare('INSERT INTO gang_members (user_id, gang_id, joined_at) VALUES (?1, ?2, ?3)')
      .bind(user.id, g.id, now)
      .run();
    return json({ tag: g.tag });
  }

  // Leave: the founder's role goes to the longest-standing member; the last one out closes the gang.
  if (!current || current.id !== g.id) return json({ ok: true });
  await db.prepare('DELETE FROM gang_members WHERE user_id = ?1').bind(user.id).run();
  const next = await db
    .prepare('SELECT user_id FROM gang_members WHERE gang_id = ?1 ORDER BY joined_at LIMIT 1')
    .bind(g.id)
    .first<{ user_id: string }>();
  if (!next) await db.prepare('DELETE FROM gangs WHERE id = ?1').bind(g.id).run();
  else if (g.owner === user.id)
    await db.prepare('UPDATE gangs SET owner = ?1 WHERE id = ?2').bind(next.user_id, g.id).run();
  return json({ ok: true });
}
