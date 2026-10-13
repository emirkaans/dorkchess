// Puzzle patches for the battle jacket (src/achievements/patches.ts): checked
// after a puzzle, daily puzzle or Puzzle Rush result of a signed-in player.

import { newPuzzlePatches } from '../src/achievements/patches.ts';
import { streakOf } from '../src/online/daily.ts';

/** Awards the puzzle patches the player's record now earns; returns their ids. */
export async function awardPuzzlePatches(
  db: D1Database,
  userId: string,
  today: string,
  now: number,
): Promise<string[]> {
  const [have, solved, daily, rush] = await db.batch([
    db.prepare('SELECT patch_id FROM user_patches WHERE user_id = ?1').bind(userId),
    db.prepare('SELECT count(*) AS n FROM puzzle_attempts WHERE user_id = ?1 AND solved = 1').bind(userId),
    db
      .prepare('SELECT day FROM daily_results WHERE user_id = ?1 AND solved = 1 ORDER BY day DESC LIMIT 400')
      .bind(userId),
    db.prepare('SELECT best FROM rush_scores WHERE user_id = ?1').bind(userId),
  ]);
  const ids = newPuzzlePatches(
    {
      puzzlesSolved: (solved.results[0] as { n: number } | undefined)?.n ?? 0,
      dailyStreak: streakOf(
        (daily.results as { day: string }[]).map((r) => r.day),
        today,
      ),
      rushBest: (rush.results[0] as { best: number } | undefined)?.best ?? 0,
    },
    new Set((have.results as { patch_id: string }[]).map((r) => r.patch_id)),
  );
  if (ids.length) {
    await db.batch(
      ids.map((id) =>
        db
          // No game earned it: game_id says where it came from instead.
          .prepare(
            "INSERT OR IGNORE INTO user_patches (user_id, patch_id, earned_at, game_id) VALUES (?1, ?2, ?3, 'puzzles')",
          )
          .bind(userId, id, now),
      ),
    );
  }
  return ids;
}
