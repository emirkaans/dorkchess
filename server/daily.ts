// The daily puzzle (migrations/0005_daily.sql):
//
//   GET  /api/daily                     today's puzzle, the player's result and streak
//   POST /api/daily/result { grid }     a signed-in player's result (the first one stays)
//
// A day's puzzle is picked the first time someone asks for it and kept, so
// everyone gets the same one; a puzzle is never a daily puzzle twice.

import { listVariants } from '../src/engine/index.ts';
import { dailyDay, dailyNumber, dayHash, gridSolved, isDailyGrid, streakOf } from '../src/online/daily.ts';
import type { DailyResponse, DailyResult, DailySaved } from '../src/online/daily.ts';
import type { PuzzleData } from '../src/online/puzzle.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';

/** Daily puzzles are of middling difficulty. */
const LOW = 1300;
const HIGH = 1800;

interface PuzzleRow {
  id: string;
  variant_id: string;
  fen: string;
  moves: string;
  rating: number;
  themes: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const toData = (r: PuzzleRow): PuzzleData => ({
  id: r.id,
  variantId: r.variant_id,
  fen: r.fen,
  moves: r.moves.split(' '),
  rating: r.rating,
  themes: r.themes ? r.themes.split(' ') : [],
});

const COLUMNS = 'p.id, p.variant_id, p.fen, p.moves, p.rating, p.themes';

/** The day's puzzle, picked now if nobody asked for it yet. */
async function puzzleOf(db: D1Database, day: string): Promise<PuzzleRow | null> {
  const kept = await db
    .prepare(`SELECT ${COLUMNS} FROM daily_puzzles d JOIN puzzles p ON p.id = d.puzzle_id WHERE d.day = ?1`)
    .bind(day)
    .first<PuzzleRow>();
  if (kept) return kept;
  const pool = `FROM puzzles p WHERE p.variant_id = ?1 AND p.rating BETWEEN ?2 AND ?3
    AND p.id NOT IN (SELECT puzzle_id FROM daily_puzzles)`;
  const variantId = listVariants()[0].id;
  const count = await db
    .prepare(`SELECT count(*) AS n ${pool}`)
    .bind(variantId, LOW, HIGH)
    .first<{ n: number }>();
  if (!count?.n) return null;
  const picked = await db
    .prepare(`SELECT p.id ${pool} ORDER BY p.id LIMIT 1 OFFSET ?4`)
    .bind(variantId, LOW, HIGH, dayHash(day) % count.n)
    .first<{ id: string }>();
  if (!picked) return null;
  // Two first requests at once: the first insert wins and both read it back.
  await db.prepare('INSERT OR IGNORE INTO daily_puzzles (day, puzzle_id) VALUES (?1, ?2)').bind(day, picked.id).run();
  return db
    .prepare(`SELECT ${COLUMNS} FROM daily_puzzles d JOIN puzzles p ON p.id = d.puzzle_id WHERE d.day = ?1`)
    .bind(day)
    .first<PuzzleRow>();
}

async function streak(db: D1Database, userId: string, today: string): Promise<number> {
  const rows = await db
    .prepare('SELECT day FROM daily_results WHERE user_id = ?1 AND solved = 1 ORDER BY day DESC LIMIT 400')
    .bind(userId)
    .all<{ day: string }>();
  return streakOf(
    rows.results.map((r) => r.day),
    today,
  );
}

/** Answers a daily puzzle request, or returns null when `url` is not one. */
export async function handleDaily(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/daily' && url.pathname !== '/api/daily/result') return null;
  if (!env.DB) return json({ error: 'puzzles-off' }, 503);
  const day = dailyDay(Date.now());

  if (url.pathname === '/api/daily' && request.method === 'GET') {
    const [row, user] = await Promise.all([puzzleOf(env.DB, day), currentUser(request, env).catch(() => null)]);
    let result: DailyResult | null = null;
    let n = 0;
    if (user) {
      const mine = await env.DB.prepare('SELECT solved, grid FROM daily_results WHERE user_id = ?1 AND day = ?2')
        .bind(user.id, day)
        .first<{ solved: number; grid: string }>();
      if (mine) result = { solved: mine.solved === 1, grid: mine.grid };
      n = await streak(env.DB, user.id, day);
    }
    return json({
      day,
      number: dailyNumber(day),
      puzzle: row ? toData(row) : null,
      result,
      streak: n,
    } satisfies DailyResponse);
  }

  if (url.pathname === '/api/daily/result' && request.method === 'POST') {
    if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    const body = (await request.json().catch(() => ({}))) as { grid?: unknown; day?: unknown };
    if (!isDailyGrid(body.grid)) return json({ error: 'bad-grid' }, 400);
    // A result from yesterday's page sent after midnight does not count for today.
    if (body.day !== day) return json({ error: 'day-over' }, 409);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO daily_results (user_id, day, solved, grid, at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(user.id, day, gridSolved(body.grid) ? 1 : 0, body.grid, Date.now())
      .run();
    return json({ streak: await streak(env.DB, user.id, day) } satisfies DailySaved);
  }

  return json({ error: 'not-found' }, 404);
}
