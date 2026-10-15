-- Players following each other (server/follows.ts).
CREATE TABLE follows (
  follower TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);
CREATE INDEX follows_followee ON follows(followee);
