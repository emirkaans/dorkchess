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
import type { Color } from '../src/engine/index.ts';

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
 * Records a finished game: aborted games (fewer than two moves) and games
 * between guests are not kept; a rated game updates both ratings. Returns the
 * room marked as recorded, with the rating changes. Throws when the database
 * fails (nothing is written then, so it can be tried again).
 */
export async function settleGame(room: Room, db: D1Database | undefined, now: number): Promise<Room> {
  if (room.phase !== 'over' || room.recorded) return room;
  const w = room.seats.w?.account ?? null;
  const b = room.seats.b?.account ?? null;
  if (!db || room.moves.length < ABORT_PLIES || (!w && !b)) return { ...room, recorded: true };
  const record: GameRecord | null = recordOfRoom(room);
  if (!record) return { ...room, recorded: true };

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
  await db.batch(statements);
  return { ...room, recorded: true, ...(diff ? { ratingDiff: diff } : {}) };
}
