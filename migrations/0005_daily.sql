-- The daily puzzle (server/daily.ts): which puzzle each day had, and who played it.

CREATE TABLE daily_puzzles (
  -- 'YYYY-MM-DD' in Turkey (UTC+3).
  day TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL UNIQUE
);

CREATE TABLE daily_results (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  solved INTEGER NOT NULL,
  -- One letter per move of the player's: h found at once, m found after misses, s shown.
  grid TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
