-- Ratings and finished online games (see src/rating/ and server/game-room.ts).

-- One row per player and rating category ('bullet', 'blitz', 'rapid', 'classical', 'variant:<id>').
CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  rating REAL NOT NULL,
  rd REAL NOT NULL,
  vol REAL NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- Finished online games with at least one signed-in player (aborted games are not kept).
-- Ratings are those before the game; the diffs are what the game changed (null when casual).
-- A profile's rating graph is drawn from these rows.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  time_control TEXT NOT NULL,
  category TEXT,
  rated INTEGER NOT NULL,
  white_user TEXT,
  black_user TEXT,
  white_name TEXT NOT NULL,
  black_name TEXT NOT NULL,
  white_rating INTEGER,
  black_rating INTEGER,
  white_diff INTEGER,
  black_diff INTEGER,
  -- '1-0', '0-1' or '1/2-1/2'
  result TEXT NOT NULL,
  termination TEXT NOT NULL,
  start_fen TEXT NOT NULL,
  -- The moves as a JSON array of SAN.
  moves TEXT NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE INDEX games_white ON games(white_user, ended_at);
CREATE INDEX games_black ON games(black_user, ended_at);
