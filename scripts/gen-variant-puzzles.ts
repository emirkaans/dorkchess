// Puzzles for the variants, made by our own engine (lichess has none of them):
//
//   node --experimental-strip-types --no-warnings scripts/gen-variant-puzzles.ts <variant> <out-dir> [count] [minutes] [seed]
//   npx wrangler d1 execute punkchess --remote --file <out-dir>/<variant>.sql
//
// Bots play each other at uneven levels; whenever a move of one side leaves
// the other a single clearly winning reply (300+ centipawns, 250+ ahead of the
// second best move, while the position was not already lost), that becomes a
// puzzle. Each candidate is checked again with a longer search, and the line
// goes on while the winning side keeps having one clearly best move (up to
// three moves of the player's). Difficulty is estimated from the line's length
// and whether its moves are quiet.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, getVariant, makeMove, setupStartPosition, toFen } from '../src/engine/index.ts';
import type { GameState, Move, VariantDefinition } from '../src/engine/index.ts';
import { MATE_BOUND } from '../src/ai/evaluate.ts';
import { levelConfig } from '../src/ai/levels.ts';
import { createRng } from '../src/ai/rng.ts';
import { chooseMove, search } from '../src/ai/search.ts';
import type { ScoredMove } from '../src/ai/search.ts';

const [variantId, outDir, countArg, minutesArg, seedArg] = process.argv.slice(2);
if (!variantId || !outDir) {
  console.error('usage: gen-variant-puzzles.ts <variant> <out-dir> [count] [minutes] [seed]');
  process.exit(1);
}
const v: VariantDefinition = getVariant(variantId);
const TARGET = Number(countArg) || 150;
const DEADLINE = Date.now() + (Number(minutesArg) || 30) * 60_000;
const rng = createRng(Number(seedArg) || 20261015);

const stats = { games: 0, plies: 0, screened: 0, lost: 0, noLine: 0 };

const WIN = 300;
const GAP = 250;
const BLUNDER = 200;
const MAX_PLAYER_MOVES = 3;

/** Root moves best first, with exact scores for the best two. */
function analyse(state: GameState, ms: number): readonly ScoredMove[] {
  const cfg = levelConfig(4);
  return search(v, state, {
    maxDepth: 64,
    quiescence: cfg.quiescence,
    transpositionTable: cfg.transpositionTable,
    mobility: cfg.mobility,
    timeLimitMs: ms,
    rootExact: { topK: 2, margin: 0 },
    analyse: true,
  }).scores;
}

/** One clearly winning move here (or a mate), or null. */
function unique(state: GameState, ms: number): ScoredMove | null {
  const s = analyse(state, ms);
  if (!s.length) return null;
  const best = s[0].score;
  const second = s.length > 1 ? s[1].score : -Infinity;
  if (best >= MATE_BOUND && second < MATE_BOUND) return s[0];
  return best >= WIN && best - second >= GAP && best < MATE_BOUND ? s[0] : null;
}

const uci = (m: Move) => {
  const sq = (n: number) => `${'abcdefgh'[n % 8]}${Math.floor(n / 8) + 1}`;
  return `${sq(m.from)}${sq(m.to)}${m.promotion ?? ''}`;
};

interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
}

const ID_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newId = () => `v${Array.from({ length: 7 }, () => ID_CHARS[Math.floor(rng.next() * ID_CHARS.length)]).join('')}`;

/** A puzzle starting with the opponent's move `opp` from `before`, if the position after it has one. */
function puzzleFrom(before: GameState, opp: Move): Puzzle | null {
  // The opponent's move was a real mistake: it gave away at least BLUNDER against its best move.
  // (Bot games are often one-sided early, so the position need not have been level.)
  const was = analyse(before, 300);
  const first = unique(makeMove(v, before, opp), 1500);
  if (!was.length || !first || Math.min(was[0].score, MATE_BOUND) + Math.min(first.score, MATE_BOUND) < BLUNDER) {
    stats.lost++;
    return null;
  }
  let state = makeMove(v, before, opp);
  const line: Move[] = [opp];
  let quiet = 0;
  let mate = false;
  for (let k = 0; k < MAX_PLAYER_MOVES; k++) {
    const best = unique(state, k === 0 ? 1500 : 1000);
    if (!best) break;
    line.push(best.move);
    if (best.move.captured === undefined) quiet++;
    state = makeMove(v, state, best.move);
    if (state.result) {
      mate = state.result.reason === 'checkmate';
      break;
    }
    if (best.score >= MATE_BOUND && k === MAX_PLAYER_MOVES - 1) break;
    const reply = analyse(state, 400)[0];
    if (!reply) break;
    // Only continue when the next move of the player's is again the only good one.
    const next = makeMove(v, state, reply.move);
    if (!unique(next, 800)) break;
    line.push(reply.move);
    state = next;
  }
  // The line ends with a move of the player's (an opponent's reply left at the end goes).
  if (line.length % 2 === 1) line.pop();
  if (line.length < 2) {
    stats.noLine++;
    return null;
  }
  const finalMoves = Math.floor(line.length / 2);
  const rating = 900 + finalMoves * 250 + quiet * 100 + Math.floor(rng.next() * 100);
  const themes = [
    mate ? `mateIn${finalMoves}` : 'advantage',
    finalMoves === 1 ? 'oneMove' : finalMoves === 2 ? 'short' : 'long',
  ];
  return { id: newId(), fen: toFen(v, before.position), moves: line.map(uci), rating, themes };
}

/** A game between bots of uneven strength (weaker ones blunder, which makes puzzles). */
function playOne(found: Puzzle[], seen: Set<string>): void {
  const answers: Record<string, string> = {};
  for (const q of v.setup?.questions ?? []) answers[q.id] = q.options[Math.floor(rng.next() * q.options.length)].id;
  let state = createGame(v, setupStartPosition(v, answers));
  const levels = { w: 2 + Math.floor(rng.next() * 3), b: 2 + Math.floor(rng.next() * 3) };
  stats.games++;
  for (let ply = 0; ply < 140 && !state.result && Date.now() < DEADLINE && found.length < TARGET; ply++) {
    const before = state;
    const move = chooseMove(v, state, levels[state.position.turn], { seed: Math.floor(rng.next() * 1e9) }).move;
    state = makeMove(v, state, move);
    stats.plies++;
    if (state.result || ply < 6) continue;
    // Quick screen first; the slow checks only for candidates.
    const s = analyse(state, 120);
    if (s.length < 2 || s[0].score < WIN || s[0].score - s[1].score < GAP) continue;
    stats.screened++;
    const p = puzzleFrom(before, move);
    if (!p || seen.has(p.fen)) continue;
    seen.add(p.fen);
    found.push(p);
    console.log(`${variantId}: ${found.length}/${TARGET} (${p.moves.length} plies, ${p.rating})`);
  }
}

const found: Puzzle[] = [];
const seen = new Set<string>();
while (found.length < TARGET && Date.now() < DEADLINE) playOne(found, seen);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
mkdirSync(outDir, { recursive: true });
const rows = found.map(
  (p) =>
    `(${q(p.id)}, ${q(v.id)}, ${q(p.fen)}, ${q(p.moves.join(' '))}, ${p.rating}, 200, ${q(p.themes.join(' '))}, 0, 0, 'punkchess')`,
);
const sql = [];
for (let i = 0; i < rows.length; i += 100) {
  sql.push(
    `INSERT OR IGNORE INTO puzzles (id, variant_id, fen, moves, rating, rd, themes, popularity, plays, source) VALUES\n${rows.slice(i, i + 100).join(',\n')};`,
  );
}
writeFileSync(join(outDir, `${variantId}.sql`), sql.join('\n') + '\n');
writeFileSync(join(outDir, `${variantId}.json`), JSON.stringify(found, null, 1));
console.log(`${variantId}: wrote ${found.length} puzzles`, stats);
