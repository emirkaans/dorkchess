// Puzzles (migrations/0004_puzzles.sql):
//
//   GET  /api/puzzles/next?rating=…&theme=…   a puzzle near the player's puzzle rating (guests send theirs)
//   GET  /api/puzzles/:id                     one puzzle (shared links)
//   POST /api/puzzles/:id/result { solved }   a signed-in player's result: the first try moves the rating

import type { PatchNews, PuzzleData, PuzzleNext, PuzzleResult } from '../src/online/puzzle.ts';
import { PUZZLE_THEMES } from '../src/online/puzzle.ts';
import { DEFAULT_GLICKO, PROVISIONAL_RD, aged, update } from '../src/rating/glicko2.ts';
import type { Glicko } from '../src/rating/glicko2.ts';
import { listVariants } from '../src/engine/index.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';
import { dailyDay } from '../src/online/daily.ts';
import { awardPuzzlePatches } from './puzzle-patches.ts';

const CATEGORY = 'puzzle';
const DAY = 86_400_000;

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

async function puzzleRating(db: D1Database, userId: string, now: number): Promise<Glicko> {
  const row = await db
    .prepare('SELECT rating, rd, vol, updated_at FROM ratings WHERE user_id = ?1 AND category = ?2')
    .bind(userId, CATEGORY)
    .first<{ rating: number; rd: number; vol: number; updated_at: number }>();
  return row ? aged({ rating: row.rating, rd: row.rd, vol: row.vol }, (now - row.updated_at) / DAY) : DEFAULT_GLICKO;
}

/** Answers a puzzle request, or returns null when `url` is not one. */
export async function handlePuzzles(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const m = /^\/api\/puzzles\/([^/]+)(\/result)?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return json({ error: 'puzzles-off' }, 503);
  const now = Date.now();

  if (m[1] === 'next' && !m[2] && request.method === 'GET') {
    const user = await currentUser(request, env).catch(() => null);
    const mine = user ? await puzzleRating(env.DB, user.id, now) : null;
    const asked = Number(url.searchParams.get('rating'));
    const target = mine ? mine.rating : Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_GLICKO.rating;
    const theme = url.searchParams.get('theme');
    const themeOk = theme && (PUZZLE_THEMES as readonly string[]).includes(theme);
    const variantId = listVariants()[0].id;
    // Close to the player's rating first, then wider; puzzles already tried are skipped.
    let row: PuzzleRow | null = null;
    for (const width of [100, 250, 600, 5000]) {
      row = await env.DB.prepare(
        `SELECT id, variant_id, fen, moves, rating, themes FROM puzzles
         WHERE variant_id = ?1 AND rating BETWEEN ?2 AND ?3
           AND (?4 IS NULL OR (' ' || themes || ' ') LIKE '% ' || ?4 || ' %')
           AND (?5 IS NULL OR id NOT IN (SELECT puzzle_id FROM puzzle_attempts WHERE user_id = ?5))
         ORDER BY random() LIMIT 1`,
      )
        .bind(
          variantId,
          Math.round(target - width),
          Math.round(target + width),
          themeOk ? theme : null,
          user?.id ?? null,
        )
        .first<PuzzleRow>();
      if (row) break;
    }
    return json({
      puzzle: row ? toData(row) : null,
      rating: mine ? { rating: Math.round(mine.rating), provisional: mine.rd > PROVISIONAL_RD } : null,
    } satisfies PuzzleNext);
  }

  if (!/^[A-Za-z0-9]{3,16}$/.test(m[1])) return json({ error: 'not-found' }, 404);

  if (!m[2] && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT id, variant_id, fen, moves, rating, themes FROM puzzles WHERE id = ?1')
      .bind(m[1])
      .first<PuzzleRow>();
    if (!row) return json({ error: 'not-found' }, 404);
    const user = await currentUser(request, env).catch(() => null);
    const mine = user ? await puzzleRating(env.DB, user.id, now) : null;
    return json({
      puzzle: toData(row),
      rating: mine ? { rating: Math.round(mine.rating), provisional: mine.rd > PROVISIONAL_RD } : null,
    } satisfies PuzzleNext);
  }

  if (m[2] && request.method === 'POST') {
    if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    const body = (await request.json().catch(() => ({}))) as { solved?: unknown };
    const solved = body.solved === true;
    const puzzle = await env.DB.prepare('SELECT rating FROM puzzles WHERE id = ?1')
      .bind(m[1])
      .first<{ rating: number }>();
    if (!puzzle) return json({ error: 'not-found' }, 404);
    const before = await puzzleRating(env.DB, user.id, now);
    const tried = await env.DB.prepare('SELECT 1 FROM puzzle_attempts WHERE user_id = ?1 AND puzzle_id = ?2')
      .bind(user.id, m[1])
      .first();
    if (tried) {
      return json({
        rating: Math.round(before.rating),
        provisional: before.rd > PROVISIONAL_RD,
        diff: 0,
      } satisfies PuzzleResult);
    }
    // The puzzle is a steady opponent: its rating is well tested on lichess.
    const after = update(before, [{ opponent: { rating: puzzle.rating, rd: 60, vol: 0.06 }, score: solved ? 1 : 0 }]);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO puzzle_attempts (user_id, puzzle_id, solved, at) VALUES (?1, ?2, ?3, ?4)',
      ).bind(user.id, m[1], solved ? 1 : 0, now),
      env.DB.prepare(
        `INSERT INTO ratings (user_id, category, rating, rd, vol, games, wins, losses, draws, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, 0, ?8)
         ON CONFLICT (user_id, category) DO UPDATE SET
           rating = ?3, rd = ?4, vol = ?5, games = games + 1, wins = wins + ?6, losses = losses + ?7, updated_at = ?8`,
      ).bind(user.id, CATEGORY, after.rating, after.rd, after.vol, solved ? 1 : 0, solved ? 0 : 1, now),
    ]);
    const newPatches = solved ? await awardPuzzlePatches(env.DB, user.id, dailyDay(now), now) : [];
    return json({
      rating: Math.round(after.rating),
      provisional: after.rd > PROVISIONAL_RD,
      diff: Math.round(after.rating) - Math.round(before.rating),
      newPatches,
    } satisfies PuzzleResult & PatchNews);
  }

  return json({ error: 'not-found' }, 404);
}
