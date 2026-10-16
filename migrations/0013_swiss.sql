-- Swiss tournaments next to Arena ones (server/tournament.ts): the format,
-- and a Swiss tournament's number of rounds. Its ends_at is an estimate until
-- it finishes.
ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'arena';
ALTER TABLE tournaments ADD COLUMN rounds INTEGER;
