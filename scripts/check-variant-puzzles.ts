// Checks puzzles made by gen-variant-puzzles.ts before they are loaded: every
// move replays legally from the position, the line ends with a move of the
// player's, and the first move is the opponent's.
//
//   node --experimental-strip-types --no-warnings scripts/check-variant-puzzles.ts <variant> <file.json>

import { readFileSync } from 'node:fs';
import { createGame, findMove, getVariant, makeMove, parseSquare } from '../src/engine/index.ts';
import type { PieceType } from '../src/engine/index.ts';

const [variantId, file] = process.argv.slice(2);
const v = getVariant(variantId);
const puzzles = JSON.parse(readFileSync(file, 'utf8')) as { id: string; fen: string; moves: string[] }[];
let bad = 0;
for (const p of puzzles) {
  try {
    let state = createGame(v, p.fen);
    if (p.moves.length < 2 || p.moves.length % 2 !== 0) throw new Error(`${p.moves.length} moves`);
    for (const uci of p.moves) {
      const promotion = uci.length > 4 ? (uci[4] as PieceType) : undefined;
      const m = findMove(v, state, parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), promotion);
      if (!m) throw new Error(`illegal ${uci}`);
      state = makeMove(v, state, m);
    }
  } catch (e) {
    bad++;
    console.log(`${p.id}: ${(e as Error).message}`);
  }
}
console.log(`${variantId}: ${puzzles.length - bad}/${puzzles.length} ok`);
if (bad) process.exit(1);
