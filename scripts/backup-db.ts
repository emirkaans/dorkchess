// A copy of the live database (accounts, ratings, games, puzzles) as SQL:
//
//   npm run backup:db
//
// writes backups/punkchess-<date>.sql (git ignores backups/: it holds players'
// data) and keeps the newest 8. To load one into a fresh database:
//   npx wrangler d1 execute <database> --remote --file backups/punkchess-<date>.sql
//
// Cloudflare also keeps D1's own history ("Time Travel": any minute of the last
// 7 days on the free plan, 30 on Workers Paid), restored with
//   npx wrangler d1 time-travel restore punkchess --timestamp=<ISO time>
// This file is for anything older, or a copy outside Cloudflare.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'backups';
const KEEP = 8;

mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = join(DIR, `punkchess-${stamp}.sql`);
execFileSync('npx', ['wrangler', 'd1', 'export', 'punkchess', '--remote', '--output', file], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log(`saved ${file} (${Math.round(statSync(file).size / 1024)} KB)`);

const old = readdirSync(DIR)
  .filter((f) => /^punkchess-.*\.sql$/.test(f))
  .sort()
  .reverse()
  .slice(KEEP);
for (const f of old) {
  rmSync(join(DIR, f));
  console.log(`removed ${f}`);
}
