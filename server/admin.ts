// Running the site, for staff only (users.role, migrations/0012_admin.sql):
//
//   GET  /api/admin/stats                      counts at a glance
//   GET  /api/admin/users?q=…                  accounts by username prefix
//   POST /api/admin/users/:id/ban { reason }   ban (signs out everywhere) / …/unban
//   POST /api/admin/users/:id/rename { username }
//   POST /api/admin/users/:id/role { role }    admins only: 'admin' | 'moderator' | null
//   GET  /api/admin/tournaments                open tournaments
//   POST /api/admin/tournaments/:id/cancel
//   GET  /api/admin/gangs?q=…                  gangs by name or tag
//   POST /api/admin/gangs/:tag/rename { name } / …/delete
//   GET  /api/admin/errors                     the latest browser error reports
//   GET  /api/admin/log                        what staff did, latest first
//
// Every request checks the role on the server; every change is logged.

import { usernameProblem } from '../src/online/account.ts';
import { ERROR_KEEP_DAYS, isStaffRole, mayDo } from '../src/online/admin.ts';
import type {
  AdminAction,
  AdminError,
  AdminGang,
  AdminLogEntry,
  AdminStats,
  AdminTournament,
  AdminUser,
  StaffRole,
} from '../src/online/admin.ts';
import { gangProblem } from '../src/online/gang.ts';
import type { LiveStats } from '../src/online/lobby.ts';
import { currentUser, sameOrigin, usernameTaken } from './auth.ts';
import type { Env } from './game-room.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const DAY = 86_400_000;

interface Staff {
  readonly id: string;
  readonly username: string;
  readonly role: StaffRole;
}

async function log(db: D1Database, staff: Staff, action: AdminAction, target: string, detail: string | null = null) {
  await db
    .prepare('INSERT INTO admin_log (at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(Date.now(), staff.username, action, target, detail)
    .run();
}

const roleOf = (r: unknown): StaffRole | null => (isStaffRole(r) ? r : null);

/** Answers an admin request, or returns null when `url` is not one. */
export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin/')) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const db = env.DB;
  const user = await currentUser(request, env).catch(() => null);
  const role = roleOf(user?.role);
  if (!user || !role) return json({ error: 'forbidden' }, 403);
  const staff: Staff = { id: user.id, username: user.username, role };
  const path = url.pathname.slice('/api/admin'.length);
  const now = Date.now();

  if (request.method === 'GET') {
    if (path === '/stats') {
      const one = (sql: string, ...args: unknown[]) =>
        db
          .prepare(sql)
          .bind(...args)
          .first<{ n: number }>()
          .then((r) => r?.n ?? 0);
      const live = await env.LOBBY.get(env.LOBBY.idFromName('main'))
        .fetch('https://lobby/stats')
        .then((r) => r.json() as Promise<LiveStats>)
        .catch(() => ({ games: 0, players: 0 }));
      const [users, usersWeek, banned, gamesDay, gamesTotal, tournamentsOpen, gangs, errorsDay] = await Promise.all([
        one('SELECT count(*) AS n FROM users'),
        one('SELECT count(*) AS n FROM users WHERE created_at >= ?1', now - 7 * DAY),
        one('SELECT count(*) AS n FROM users WHERE banned_at IS NOT NULL'),
        one('SELECT count(*) AS n FROM games WHERE ended_at >= ?1', now - DAY),
        one('SELECT count(*) AS n FROM games'),
        one('SELECT count(*) AS n FROM tournaments WHERE ends_at > ?1', now),
        one('SELECT count(*) AS n FROM gangs'),
        one('SELECT count(*) AS n FROM error_reports WHERE at >= ?1', now - DAY),
      ]);
      return json({
        users,
        usersWeek,
        banned,
        gamesDay,
        gamesTotal,
        liveGames: live.games,
        online: live.players,
        tournamentsOpen,
        gangs,
        errorsDay,
      } satisfies AdminStats);
    }
    if (path === '/users') {
      const q = (url.searchParams.get('q') ?? '').trim();
      // Banned accounts first when nothing is searched (the ones to look at).
      const rows = await db
        .prepare(
          `SELECT u.id, u.username, u.created_at, u.role, u.banned_at, u.ban_reason,
             (SELECT count(*) FROM games g WHERE g.white_user = u.id OR g.black_user = u.id) AS games
           FROM users u WHERE ?1 = '' OR u.username LIKE ?2 ESCAPE '\\'
           ORDER BY (u.banned_at IS NULL), u.created_at DESC LIMIT 30`,
        )
        .bind(q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
        .all<{
          id: string;
          username: string;
          created_at: number;
          role: string | null;
          banned_at: number | null;
          ban_reason: string | null;
          games: number;
        }>();
      return json(
        rows.results.map((r): AdminUser => ({
          id: r.id,
          username: r.username,
          createdAt: r.created_at,
          role: roleOf(r.role),
          bannedAt: r.banned_at,
          banReason: r.ban_reason,
          games: r.games,
        })),
      );
    }
    if (path === '/tournaments') {
      const rows = await db
        .prepare(
          `SELECT t.id, t.name, u.username AS owner, t.starts_at, t.ends_at, t.players
           FROM tournaments t LEFT JOIN users u ON u.id = t.owner_id
           WHERE t.ends_at > ?1 ORDER BY t.starts_at LIMIT 100`,
        )
        .bind(now)
        .all<{ id: string; name: string; owner: string | null; starts_at: number; ends_at: number; players: number }>();
      return json(
        rows.results.map((r): AdminTournament => ({
          id: r.id,
          name: r.name,
          owner: r.owner,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          players: r.players,
        })),
      );
    }
    if (path === '/gangs') {
      const q = (url.searchParams.get('q') ?? '').trim();
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await db
        .prepare(
          `SELECT g.tag, g.name, u.username AS owner,
             (SELECT count(*) FROM gang_members m WHERE m.gang_id = g.id) AS members
           FROM gangs g JOIN users u ON u.id = g.owner
           WHERE ?1 = '' OR g.name LIKE ?2 ESCAPE '\\' OR g.tag LIKE ?2 ESCAPE '\\'
           ORDER BY g.created_at DESC LIMIT 50`,
        )
        .bind(q, like)
        .all<{ tag: string; name: string; owner: string; members: number }>();
      return json(rows.results satisfies AdminGang[]);
    }
    if (path === '/errors') {
      const rows = await db
        .prepare('SELECT at, report FROM error_reports ORDER BY at DESC LIMIT 100')
        .all<{ at: number; report: string }>();
      return json(rows.results satisfies AdminError[]);
    }
    if (path === '/log') {
      const rows = await db
        .prepare('SELECT at, actor, action, target, detail FROM admin_log ORDER BY at DESC LIMIT 100')
        .all<AdminLogEntry>();
      return json(rows.results);
    }
    return json({ error: 'not-found' }, 404);
  }

  if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const u = /^\/users\/([^/]+)\/(ban|unban|rename|role)$/.exec(path);
  if (u) {
    const target = await db
      .prepare('SELECT id, username, role FROM users WHERE id = ?1')
      .bind(u[1])
      .first<{ id: string; username: string; role: string | null }>();
    if (!target) return json({ error: 'not-found' }, 404);
    const action: AdminAction =
      u[2] === 'ban' ? 'ban' : u[2] === 'unban' ? 'unban' : u[2] === 'rename' ? 'rename-user' : 'set-role';
    if (!mayDo(staff.role, action, roleOf(target.role))) return json({ error: 'forbidden' }, 403);
    if (target.id === staff.id && action !== 'rename-user') return json({ error: 'self' }, 400);

    if (action === 'ban') {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
      await db.batch([
        db
          .prepare('UPDATE users SET banned_at = ?1, ban_reason = ?2 WHERE id = ?3')
          .bind(now, reason || null, target.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(target.id),
      ]);
      await log(db, staff, action, target.username, reason || null);
    } else if (action === 'unban') {
      await db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?1').bind(target.id).run();
      await log(db, staff, action, target.username);
    } else if (action === 'rename-user') {
      const name = typeof body.username === 'string' ? body.username.trim() : '';
      const problem = usernameProblem(name);
      if (problem) return json({ error: problem }, 400);
      if (name.toLowerCase() !== target.username.toLowerCase() && (await usernameTaken(env, name))) {
        return json({ error: 'taken' }, 409);
      }
      await db.prepare('UPDATE users SET username = ?1 WHERE id = ?2').bind(name, target.id).run();
      await log(db, staff, action, target.username, name);
    } else {
      const next = body.role === null ? null : roleOf(body.role);
      if (body.role !== null && !next) return json({ error: 'bad-request' }, 400);
      await db.prepare('UPDATE users SET role = ?1 WHERE id = ?2').bind(next, target.id).run();
      await log(db, staff, action, target.username, next ?? 'none');
    }
    return json({ ok: true });
  }

  const t = /^\/tournaments\/([A-Za-z0-9]{8})\/cancel$/.exec(path);
  if (t) {
    const row = await db.prepare('SELECT name FROM tournaments WHERE id = ?1').bind(t[1]).first<{ name: string }>();
    if (!row) return json({ error: 'not-found' }, 404);
    await env.TOURNAMENT.get(env.TOURNAMENT.idFromName(t[1]))
      .fetch('https://tournament/cancel', { method: 'POST' })
      .catch(() => null);
    await db.prepare('DELETE FROM tournaments WHERE id = ?1').bind(t[1]).run();
    await log(db, staff, 'cancel-tournament', row.name, t[1]);
    return json({ ok: true });
  }

  const g = /^\/gangs\/([A-Za-z0-9]{2,4})\/(rename|delete)$/.exec(path);
  if (g) {
    const gang = await db
      .prepare('SELECT id, tag, name FROM gangs WHERE tag = ?1')
      .bind(g[1].toUpperCase())
      .first<{ id: string; tag: string; name: string }>();
    if (!gang) return json({ error: 'not-found' }, 404);
    if (g[2] === 'delete') {
      await db.batch([
        db.prepare('DELETE FROM gang_members WHERE gang_id = ?1').bind(gang.id),
        db.prepare('DELETE FROM gangs WHERE id = ?1').bind(gang.id),
      ]);
      await log(db, staff, 'delete-gang', `[${gang.tag}] ${gang.name}`);
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (gangProblem(name, gang.tag)) return json({ error: 'name' }, 400);
      const taken = await db.prepare('SELECT 1 FROM gangs WHERE name = ?1 AND id != ?2').bind(name, gang.id).first();
      if (taken) return json({ error: 'taken' }, 409);
      await db.prepare('UPDATE gangs SET name = ?1 WHERE id = ?2').bind(name, gang.id).run();
      await log(db, staff, 'rename-gang', `[${gang.tag}] ${gang.name}`, name);
    }
    return json({ ok: true });
  }

  return json({ error: 'not-found' }, 404);
}

/** Keeps a browser's error report (and now and then forgets the old ones). */
export async function keepErrorReport(db: D1Database | undefined, report: unknown) {
  if (!db) return;
  const now = Date.now();
  await db.prepare('INSERT INTO error_reports (at, report) VALUES (?1, ?2)').bind(now, JSON.stringify(report)).run();
  if (Math.random() < 0.05) {
    await db
      .prepare('DELETE FROM error_reports WHERE at < ?1')
      .bind(now - ERROR_KEEP_DAYS * DAY)
      .run();
  }
}
