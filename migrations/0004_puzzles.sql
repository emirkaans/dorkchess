-- Puzzles (scripts/import-puzzles.ts fills them) and who solved which.
-- A player's puzzle rating is a row in `ratings` with category 'puzzle'.

CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  -- The position before the opponent's move that sets the puzzle up.
  fen TEXT NOT NULL,
  -- Solution in UCI, space-separated: the opponent's move first, then the player's, and so on.
  moves TEXT NOT NULL,
  rating INTEGER NOT NULL,
  rd INTEGER NOT NULL,
  -- Space-separated themes (lichess names: mateIn2, fork, pin, …).
  themes TEXT NOT NULL,
  popularity INTEGER NOT NULL,
  plays INTEGER NOT NULL,
  -- Where it comes from: 'lichess' (CC0 puzzle database) or 'punkchess' (made by our engine).
  source TEXT NOT NULL
);
CREATE INDEX puzzles_pick ON puzzles(variant_id, rating);

CREATE TABLE puzzle_attempts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL,
  solved INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, puzzle_id)
);
