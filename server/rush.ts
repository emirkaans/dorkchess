// Puzzle Rush:
//
//   GET  /api/rush                     a run's puzzles, easiest first, and the player's best score
//   POST /api/rush/result { score }    a signed-in player's score (the best one is kept)
//
// Rush results do not change the puzzle rating.

import { listVariants } from '../src/engine/index.ts';
import { dailyDay } from '../src/online/daily.ts';
import { RUSH_COUNT, RUSH_START, RUSH_STEP } from '../src/online/puzzle.ts';
import type { PuzzleData, RushResponse, RushSaved } from '../src/online/puzzle.ts';
import type { AuthEnv } from './auth.ts';
import { currentUser, sameOrigin } from './auth.ts';
import { awardPuzzlePatches } from './puzzle-patches.ts';

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

/** Answers a Puzzle Rush request, or returns null when `url` is not one. */
export async function handleRush(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/rush' && url.pathname !== '/api/rush/result') return null;
  if (!env.DB) return json({ error: 'puzzles-off' }, 503);

  if (url.pathname === '/api/rush' && request.method === 'GET') {
    const variantId = listVariants()[0].id;
    // One puzzle per difficulty step: a random point in the step and a small random
    // offset along the rating index. Cheap to read, and different puzzles every run.
    const statements = Array.from({ length: RUSH_COUNT }, (_, i) =>
      env.DB.prepare(
        `SELECT id, variant_id, fen, moves, rating, themes FROM puzzles
         WHERE variant_id = ?1 AND rating >= ?2 ORDER BY rating LIMIT 1 OFFSET ?3`,
      ).bind(
        variantId,
        RUSH_START + i * RUSH_STEP + Math.floor(Math.random() * RUSH_STEP),
        Math.floor(Math.random() * 10),
      ),
    );
    const user = await currentUser(request, env).catch(() => null);
    const [results, best] = await Promise.all([
      env.DB.batch<PuzzleRow>(statements),
      user
        ? env.DB.prepare('SELECT best FROM rush_scores WHERE user_id = ?1').bind(user.id).first<{ best: number }>()
        : null,
    ]);
    const seen = new Set<string>();
    const puzzles: PuzzleData[] = [];
    for (const r of results) {
      const row = r.results[0];
      if (row && !seen.has(row.id)) {
        seen.add(row.id);
        puzzles.push(toData(row));
      }
    }
    return json({ puzzles, best: user ? (best?.best ?? 0) : null } satisfies RushResponse);
  }

  if (url.pathname === '/api/rush/result' && request.method === 'POST') {
    if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    const body = (await request.json().catch(() => ({}))) as { score?: unknown };
    const score = body.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > RUSH_COUNT) {
      return json({ error: 'bad-score' }, 400);
    }
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rush_scores (user_id, best, runs, updated_at) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (user_id) DO UPDATE SET best = max(best, ?2), runs = runs + 1, updated_at = ?3`,
    )
      .bind(user.id, score, now)
      .run();
    const row = await env.DB.prepare('SELECT best FROM rush_scores WHERE user_id = ?1')
      .bind(user.id)
      .first<{ best: number }>();
    const newPatches = await awardPuzzlePatches(env.DB, user.id, dailyDay(now), now);
    return json({ best: row?.best ?? score, newPatches } satisfies RushSaved);
  }

  return json({ error: 'not-found' }, 404);
}
