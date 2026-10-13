-- The leaderboard reads each category's ratings from the top.
CREATE INDEX ratings_board ON ratings(category, rating DESC);

-- Puzzle Rush (server/rush.ts): each signed-in player's best score.
CREATE TABLE rush_scores (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  best INTEGER NOT NULL,
  runs INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
