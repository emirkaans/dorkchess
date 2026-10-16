-- Arena tournaments (server/tournament.ts). The live state (players, scores,
-- games) is in each tournament's Durable Object; this table lists them and
-- keeps the final standings.
CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  variant_id TEXT NOT NULL,
  time_control_id TEXT NOT NULL,
  rated INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  players INTEGER NOT NULL DEFAULT 0,
  -- The winner's username, once finished.
  winner TEXT,
  -- Final standings: JSON [{ username, score, games }] (top 50), once finished.
  standings TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX tournaments_ends ON tournaments(ends_at);
CREATE INDEX tournaments_owner ON tournaments(owner_id, ends_at);
