// Training data for evaluation tuning: fast bot-vs-bot games in parallel
// worker threads; writes one line per quiet position: "<fen>|<result>", result
// from White's view (1, 0.5, 0).
//
//   npm run gen-data -- --variant standard --games 3000 --time 30 --out data/standard.txt

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createGame, getVariant, isInCheck, legalMoves, makeMove, toFen } from '../src/engine/index.ts';
import { createRng } from '../src/ai/rng.ts';
import { chooseMove } from '../src/ai/search.ts';

interface Options {
  variant: string;
  games: number;
  time: number;
  out: string;
  seed: number;
  threads: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    variant: 'standard',
    games: 1000,
    time: 30,
    out: 'data/positions.txt',
    seed: 1,
    threads: Math.max(1, availableParallelism() - 2),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--variant') o.variant = v;
    else if (k === '--games') o.games = Number(v);
    else if (k === '--time') o.time = Number(v);
    else if (k === '--out') o.out = v;
    else if (k === '--seed') o.seed = Number(v);
    else if (k === '--threads') o.threads = Number(v);
    else throw new Error(`Bilinmeyen seçenek: ${k}`);
  }
  return o;
}

/** Plays one game; returns its quiet positions with the final result. */
function playGame(o: Options, game: number): string[] {
  const v = getVariant(o.variant);
  const rng = createRng(o.seed * 1_000_003 + game);
  let state = createGame(v);
  const fens: string[] = [];
  // 8 random plies for variety, then the bot plays both sides.
  for (let ply = 0; !state.result && state.position.fullmove <= 200; ply++) {
    const pos = state.position;
    const move =
      ply < 8 ? rng.pick(legalMoves(v, pos)) : chooseMove(v, state, 5, { rng, timeLimitMs: o.time }).move;
    // Keep positions that are quiet: not in check and the chosen move is not a capture or promotion.
    if (ply >= 8 && !isInCheck(v, pos) && move.captured === undefined && !move.promotion) fens.push(toFen(v, pos));
    state = makeMove(v, state, move);
  }
  const r = state.result;
  const result = !r || r.winner === null ? 0.5 : r.winner === 'w' ? 1 : 0;
  return fens.map((f) => `${f}|${result}`);
}

if (isMainThread) {
  const o = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, '');
  let next = 0;
  let done = 0;
  let lines = 0;
  const t0 = Date.now();
  for (let i = 0; i < o.threads; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: o });
    w.on('message', (msg: string[] | 'ready') => {
      if (msg !== 'ready') {
        appendFileSync(o.out, msg.join('\n') + (msg.length ? '\n' : ''));
        lines += msg.length;
        done++;
        if (done % 50 === 0 || done === o.games) {
          console.log(`${done}/${o.games} oyun, ${lines} konum, ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
        }
      }
      w.postMessage(next < o.games ? next++ : -1);
    });
  }
} else {
  const o = workerData as Options;
  parentPort!.on('message', (game: number) => {
    if (game < 0) process.exit(0);
    parentPort!.postMessage(playGame(o, game));
  });
  parentPort!.postMessage('ready');
}
