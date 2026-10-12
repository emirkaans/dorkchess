-- Accounts. A user is a username; how they sign in lives in `identities`, so
-- more ways (email and password, another provider) can be added later
-- without touching users or sessions.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Chosen by the player at the first sign-in; unique without regard to case.
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  -- Filled in once rated games exist.
  rating INTEGER
);

-- One row per way of signing in: ('google', <Google account id>) for now.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- Signed-in browsers. `id` is the SHA-256 of the cookie's token, so the
-- table alone cannot be used to sign in.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A sign-in that has no account yet: kept until the player picks a username.
CREATE TABLE signups (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  suggested TEXT,
  expires_at INTEGER NOT NULL
);
