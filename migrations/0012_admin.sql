-- Running the site (server/admin.ts): staff roles, bans, a log of what staff
-- did, and the browsers' error reports (kept two weeks).

-- 'admin' (everything, including roles) or 'moderator' (bans, names,
-- tournaments, gangs); NULL for everyone else.
ALTER TABLE users ADD COLUMN role TEXT;
-- A banned account cannot sign in and is left out of rankings and profiles.
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN ban_reason TEXT;

-- Who did what, kept when the staff account or the target is deleted.
CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX admin_log_at ON admin_log(at);

-- Error reports from browsers (src/ui/errorReport.ts), as JSON.
CREATE TABLE error_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  report TEXT NOT NULL
);
CREATE INDEX error_reports_at ON error_reports(at);
