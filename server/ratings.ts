// Ratings in D1 (migrations/0002_ratings.sql): looking them up for a game,
// and recording a finished game (the game row and both ratings in one batch,
// so a game never counts twice or half).

import { recordOfRoom } from '../src/online/record.ts';
import type { GameRecord } from '../src/online/record.ts';
import { ABORT_PLIES, ratedRoom } from '../src/online/room.ts';
import type { Room, SeatRating } from '../src/online/room.ts';
import { ratingCategory } from '../src/rating/categories.ts';
import { DEFAULT_GLICKO, aged, isProvisional, rateGame } from '../src/rating/glicko2.ts';
import type { Glicko } from '../src/rating/glicko2.ts';
import { listVariants } from '../src/engine/index.ts';
import type { Color } from '../src/engine/index.ts';
import { newPatches } from '../src/achievements/patches.ts';
import type { PatchContext } from '../src/achievements/patches.ts';

interface RatingRow {
  user_id: string;
  rating: number;
  rd: number;
  vol: number;
  updated_at: number;
}

const DAY = 86_400_000;

/** Current ratings of these players in a category (newcomers get the default), grown uncertain with time away. */
export async function currentRatings(
  db: D1Database,
  userIds: readonly string[],
  category: string,
  now: number,
): Promise<Map<string, Glicko>> {
  const rows = await db
    .prepare(`SELECT user_id, rating, rd, vol, updated_at FROM ratings WHERE category = ?1 AND user_id IN (?2, ?3)`)
    .bind(category, userIds[0], userIds[1] ?? userIds[0])
    .all<RatingRow>();
  const out = new Map<string, Glicko>();
  for (const id of userIds) {
    const row = rows.results.find((r) => r.user_id === id);
    out.set(
      id,
      row ? aged({ rating: row.rating, rd: row.rd, vol: row.vol }, (now - row.updated_at) / DAY) : DEFAULT_GLICKO,
    );
  }
  return out;
}

/** A rated room gets both players' ratings to show (once, when both seats are taken). */
export async function withRatings(room: Room, db: D1Database | undefined, now: number): Promise<Room> {
  if (!db || !ratedRoom(room) || room.ratings) return room;
  const category = ratingCategory(room.variantId, room.timeControlId)!;
  const w = room.seats.w!.account!.id;
  const b = room.seats.b!.account!.id;
  try {
    const ratings = await currentRatings(db, [w, b], category, now);
    const shown = (g: Glicko): SeatRating => ({ rating: g.rating, provisional: isProvisional(g) });
    return { ...room, ratings: { w: shown(ratings.get(w)!), b: shown(ratings.get(b)!) } };
  } catch {
    // Without the database the game is still played, just not rated.
    return { ...room, rated: false };
  }
}

/**
 * Records a finished game: games between guests are not kept; an aborted game
 * (fewer than two moves) is kept for the players' histories only, with result
 * '*' and termination 'aborted', counting for nothing (ratings, statistics,
 * patches, rivals, gangs); a rated game updates both ratings. Returns the room
 * marked as recorded, with the rating changes. Throws when the database fails
 * (nothing is written then, so it can be tried again).
 */
export async function settleGame(room: Room, db: D1Database | undefined, now: number): Promise<Room> {
  if (room.phase !== 'over' || room.recorded) return room;
  const w = room.seats.w?.account ?? null;
  const b = room.seats.b?.account ?? null;
  if (!db || (!w && !b)) return { ...room, recorded: true };
  const record: GameRecord | null = recordOfRoom(room);
  if (!record) return { ...room, recorded: true };
  if (room.moves.length < ABORT_PLIES) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO games (id, variant_id, time_control, category, rated, white_user, black_user, white_name,
           black_name, result, termination, start_fen, moves, ended_at)
         VALUES (?1, ?2, ?3, NULL, 0, ?4, ?5, ?6, ?7, '*', 'aborted', ?8, ?9, ?10)`,
      )
      .bind(
        room.id,
        room.variantId,
        room.timeControlId,
        w?.id ?? null,
        b?.id ?? null,
        record.white,
        record.black,
        record.startFen,
        JSON.stringify(record.moves),
        now,
      )
      .run();
    return { ...room, recorded: true };
  }

  const category = ratingCategory(room.variantId, room.timeControlId);
  const rated = ratedRoom(room) && category !== null;
  const winner = room.outcome?.winner ?? null;
  const whiteScore = winner === 'w' ? 1 : winner === 'b' ? 0 : 0.5;

  const statements: D1PreparedStatement[] = [];
  let diff: Partial<Record<Color, number>> | undefined;
  let before: Partial<Record<Color, Glicko>> = {};
  if (rated) {
    const current = await currentRatings(db, [w!.id, b!.id], category, now);
    const old = { w: current.get(w!.id)!, b: current.get(b!.id)! };
    const next = rateGame(old.w, old.b, whiteScore);
    before = old;
    diff = {
      w: Math.round(next.white.rating) - Math.round(old.w.rating),
      b: Math.round(next.black.rating) - Math.round(old.b.rating),
    };
    const upsert = (userId: string, g: Glicko, score: number) =>
      db
        .prepare(
          `INSERT INTO ratings (user_id, category, rating, rd, vol, games, wins, losses, draws, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9)
           ON CONFLICT (user_id, category) DO UPDATE SET
             rating = ?3, rd = ?4, vol = ?5, games = games + 1,
             wins = wins + ?6, losses = losses + ?7, draws = draws + ?8, updated_at = ?9`,
        )
        .bind(
          userId,
          category,
          g.rating,
          g.rd,
          g.vol,
          score === 1 ? 1 : 0,
          score === 0 ? 1 : 0,
          score === 0.5 ? 1 : 0,
          now,
        );
    statements.push(upsert(w!.id, next.white, whiteScore), upsert(b!.id, next.black, 1 - whiteScore));
  }
  // The game row first: a second attempt fails on its id, so ratings never change twice.
  statements.unshift(
    db
      .prepare(
        `INSERT INTO games (id, variant_id, time_control, category, rated, white_user, black_user, white_name,
           black_name, white_rating, black_rating, white_diff, black_diff, result, termination, start_fen, moves, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      )
      .bind(
        room.id,
        room.variantId,
        room.timeControlId,
        category,
        rated ? 1 : 0,
        w?.id ?? null,
        b?.id ?? null,
        record.white,
        record.black,
        before.w ? Math.round(before.w.rating) : null,
        before.b ? Math.round(before.b.rating) : null,
        diff?.w ?? null,
        diff?.b ?? null,
        record.result,
        record.termination,
        record.startFen,
        JSON.stringify(record.moves),
        now,
      ),
  );
  // Patches for the battle jacket, written in the same batch.
  const earned: Partial<Record<Color, string[]>> = {};
  for (const color of ['w', 'b'] as const) {
    const account = color === 'w' ? w : b;
    if (!account) continue;
    const won = winner === color;
    const ids = await earnedPatches(db, account.id, {
      color,
      won,
      drawn: winner === null,
      termination: record.termination,
      moves: record.moves,
      variantId: room.variantId,
      timeControlId: room.timeControlId,
      rated,
      rating: before[color] ? Math.round(before[color].rating) : null,
      opponentRating: before[color === 'w' ? 'b' : 'w'] ? Math.round(before[color === 'w' ? 'b' : 'w']!.rating) : null,
      clockLeftMs: Number.isFinite(room.clock.remaining[color]) ? room.clock.remaining[color] : null,
      gamesPlayed: 0,
      winStreak: 0,
      variantsWon: [],
      allVariants: listVariants().map((v) => v.id),
    });
    if (!ids.length) continue;
    earned[color] = ids;
    for (const id of ids) {
      statements.push(
        db
          .prepare('INSERT OR IGNORE INTO user_patches (user_id, patch_id, earned_at, game_id) VALUES (?1, ?2, ?3, ?4)')
          .bind(account.id, id, now, room.id),
      );
    }
  }

  await db.batch(statements);
  return {
    ...room,
    recorded: true,
    ...(diff ? { ratingDiff: diff } : {}),
    ...(Object.keys(earned).length ? { newPatches: earned } : {}),
  };
}

/**
 * Patches a game earns a player: the game's own facts plus what earlier games
 * say (games played, win streak, variants won), which this game is added to.
 */
async function earnedPatches(db: D1Database, userId: string, game: PatchContext): Promise<string[]> {
  const [have, count, recent, variants] = await db.batch([
    db.prepare('SELECT patch_id FROM user_patches WHERE user_id = ?1').bind(userId),
    db
      .prepare("SELECT count(*) AS n FROM games WHERE (white_user = ?1 OR black_user = ?1) AND result != '*'")
      .bind(userId),
    db
      .prepare(
        "SELECT result, white_user FROM games WHERE (white_user = ?1 OR black_user = ?1) AND result != '*' ORDER BY ended_at DESC LIMIT 10",
      )
      .bind(userId),
    db
      .prepare(
        `SELECT DISTINCT variant_id FROM games
         WHERE (white_user = ?1 AND result = '1-0') OR (black_user = ?1 AND result = '0-1')`,
      )
      .bind(userId),
  ]);
  const owned = new Set((have.results as { patch_id: string }[]).map((r) => r.patch_id));
  let streak = game.won ? 1 : 0;
  if (game.won) {
    for (const r of recent.results as { result: string; white_user: string | null }[]) {
      const wasWhite = r.white_user === userId;
      if (r.result === (wasWhite ? '1-0' : '0-1')) streak++;
      else break;
    }
  }
  const won = new Set((variants.results as { variant_id: string }[]).map((r) => r.variant_id));
  if (game.won) won.add(game.variantId);
  return newPatches(
    {
      ...game,
      gamesPlayed: ((count.results[0] as { n: number } | undefined)?.n ?? 0) + 1,
      winStreak: streak,
      variantsWon: [...won],
    },
    owned,
  );
}
