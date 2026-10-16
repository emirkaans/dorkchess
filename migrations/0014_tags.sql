-- Spray tags (src/achievements/tags.ts): the style a player picked for the
-- signature sprayed on the board when they checkmate. NULL: the default.
ALTER TABLE users ADD COLUMN tag TEXT;
