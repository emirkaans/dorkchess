-- Patches on a player's battle jacket (src/achievements/patches.ts), earned in online games.
CREATE TABLE user_patches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patch_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  -- The game that earned it.
  game_id TEXT NOT NULL,
  PRIMARY KEY (user_id, patch_id)
);
