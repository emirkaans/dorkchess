-- Gangs (server/gangs.ts): teams of players; a player is in one gang at most.
CREATE TABLE gangs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- 2 to 4 capital letters or digits, shown as [TAG]; the gang's address (/gang/TAG).
  tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE gang_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gang_id TEXT NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL
);
CREATE INDEX gang_members_gang ON gang_members(gang_id);
