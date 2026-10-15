-- Challenges from a profile (server/challenges.ts): a game made for one player, who is told about it.
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  time_control TEXT NOT NULL,
  rated INTEGER NOT NULL,
  -- 'open', 'accepted' or 'declined'; an open one runs out after a while (see CHALLENGE_TTL_MS).
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX challenges_to ON challenges(to_user, status, created_at);
