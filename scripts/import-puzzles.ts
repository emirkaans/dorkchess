// Picks puzzles from the lichess puzzle database (CC0, https://database.lichess.org/#puzzles)
// and writes them as SQL for the `puzzles` table:
//
//   node --experimental-strip-types --no-warnings scripts/import-puzzles.ts <lichess_db_puzzle.csv.zst> <out-dir> [count]
//   npx wrangler d1 execute punkchess --remote --file <out-dir>/puzzles-001.sql   (and the others)
//
// Only well-tested puzzles are kept (popular, played often, settled rating), spread
// evenly over ratings 400–3200, and every one is replayed with our engine.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { createGame, findMove, listVariants, makeMove } from '../src/engine/index.ts';
import { parseSquare } from '../src/engine/board.ts';
import type { PieceType } from '../src/engine/index.ts';

const [input, outDir, countArg] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('usage: import-puzzles.ts <lichess_db_puzzle.csv.zst> <out-dir> [count]');
  process.exit(1);
}
const TARGET = Number(countArg) || 30_000;
const LOW = 400;
const HIGH = 3200;
const STEP = 100;
const BUCKETS = (HIGH - LOW) / STEP;
const PER_BUCKET = Math.ceil(TARGET / BUCKETS);
const ROWS_PER_INSERT = 200;
const ROWS_PER_FILE = 3000;

interface Row {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  rd: number;
  popularity: number;
  plays: number;
  themes: string;
}

// Reservoir sampling per rating bucket, with a fixed seed so a rerun picks the same puzzles.
let seed = 20261012;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const buckets: Row[][] = Array.from({ length: BUCKETS }, () => []);
const seen: number[] = Array(BUCKETS).fill(0);

const standard = listVariants()[0];

/** The puzzle replays legally with our engine. */
function valid(r: Row): boolean {
  try {
    let state = createGame(standard, r.fen);
    for (const uci of r.moves.split(' ')) {
      const promotion = uci.length > 4 ? (uci[4] as PieceType) : undefined;
      const move = findMove(standard, state, parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), promotion);
      if (!move) return false;
      state = makeMove(standard, state, move);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The CSV text of the lichess file. It is "seekable" zstd: many independent frames with
 * skippable frames (the seek table) among them, which Node's streaming decompressor
 * stops at. So the frames are found here and each is decompressed on its own.
 */
function* csvChunks(path: string): Generator<string> {
  const data = readFileSync(path);
  let at = 0;
  while (at + 8 <= data.length) {
    const magic = data.readUInt32LE(at);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      at += 8 + data.readUInt32LE(at + 4);
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error(`not a zstd frame at byte ${at}`);
    const start = at;
    const fhd = data[at + 4];
    const singleSegment = (fhd >> 5) & 1;
    const fcsSize = [singleSegment ? 1 : 0, 2, 4, 8][fhd >> 6];
    const dictSize = [0, 1, 2, 4][fhd & 3];
    at += 4 + 1 + (singleSegment ? 0 : 1) + dictSize + fcsSize;
    for (;;) {
      const header = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >> 3;
      at += 3 + (type === 1 ? 1 : size);
      if (last) break;
    }
    if ((fhd >> 2) & 1) at += 4;
    yield zstdDecompressSync(data.subarray(start, at)).toString('utf8');
  }
}

/** The lines of the CSV, across frame boundaries. */
function* csvLines(path: string): Generator<string> {
  let rest = '';
  for (const chunk of csvChunks(path)) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    yield* parts;
  }
  if (rest) yield rest;
}

let total = 0;
for (const line of csvLines(input)) {
  if (total++ === 0 && line.startsWith('PuzzleId')) continue;
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  const f = line.split(',');
  const row: Row = {
    id: f[0],
    fen: f[1],
    moves: f[2],
    rating: Number(f[3]),
    rd: Number(f[4]),
    popularity: Number(f[5]),
    plays: Number(f[6]),
    themes: f[7],
  };
  if (row.popularity < 85 || row.plays < 300 || row.rd > 90) continue;
  if (row.rating < LOW || row.rating >= HIGH || !/^[A-Za-z0-9]{5}$/.test(row.id)) continue;
  const b = Math.floor((row.rating - LOW) / STEP);
  seen[b]++;
  if (buckets[b].length < PER_BUCKET) buckets[b].push(row);
  else {
    const j = Math.floor(random() * seen[b]);
    if (j < PER_BUCKET) buckets[b][j] = row;
  }
  if (total % 500_000 === 0) console.log(`${total} lines read`);
}

const picked = buckets.flat().filter(valid);
console.log(`read ${total} lines; picked ${picked.length} puzzles`);
for (let b = 0; b < BUCKETS; b++) console.log(`  ${LOW + b * STEP}: ${buckets[b].length} of ${seen[b]}`);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
mkdirSync(outDir, { recursive: true });
let file = 0;
for (let i = 0; i < picked.length; i += ROWS_PER_FILE) {
  const rows = picked.slice(i, i + ROWS_PER_FILE);
  const statements: string[] = [];
  for (let j = 0; j < rows.length; j += ROWS_PER_INSERT) {
    const values = rows
      .slice(j, j + ROWS_PER_INSERT)
      .map(
        (r) =>
          `(${q(r.id)}, ${q(standard.id)}, ${q(r.fen)}, ${q(r.moves)}, ${r.rating}, ${r.rd}, ${q(r.themes)}, ${r.popularity}, ${r.plays}, 'lichess')`,
      );
    statements.push(
      `INSERT OR IGNORE INTO puzzles (id, variant_id, fen, moves, rating, rd, themes, popularity, plays, source) VALUES\n${values.join(',\n')};`,
    );
  }
  const name = `puzzles-${String(++file).padStart(3, '0')}.sql`;
  writeFileSync(join(outDir, name), statements.join('\n') + '\n');
}
console.log(`wrote ${file} files to ${outDir}`);
