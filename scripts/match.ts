// Engine vs engine match for measuring strength changes, run in parallel
// worker threads. Each engine is a checkout of this project (its src/ folder):
// "." is the working tree; an older version can be extracted with
//   git worktree add ../dork-old <commit>   (or git archive)
//
//   npm run match -- --a . --b ../dork-old --level-a 5 --level-b 5 --time 200 --games 200 --variant standard
//
// Openings: random 4-ply sequences, each played twice with colours swapped.
// Prints the score of A and the Elo difference with a 95% error margin.

import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

interface Options {
  a: string;
  b: string;
  levelA: number;
  levelB: number;
  timeA: number;
  timeB: number;
  games: number;
  variant: string;
  seed: number;
  threads: number;
  maxMoves: number;
}

interface Job {
  opening: number;
  /** true: engine A plays white */
  aWhite: boolean;
}

interface GameResult {
  /** 1 = A won, 0.5 = draw, 0 = A lost */
  score: number;
  reason: string;
  plies: number;
}

type Engine = {
  search: typeof import('../src/ai/search.ts');
  engine: typeof import('../src/engine/index.ts');
  rng: typeof import('../src/ai/rng.ts');
};

async function loadEngine(dir: string): Promise<Engine> {
  const url = (p: string) => pathToFileURL(resolve(dir, p)).href;
  return {
    search: await import(url('src/ai/search.ts')),
    engine: await import(url('src/engine/index.ts')),
    rng: await import(url('src/ai/rng.ts')),
  };
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    a: '.',
    b: '.',
    levelA: 5,
    levelB: 5,
    timeA: 200,
    timeB: 200,
    games: 100,
    variant: 'standard',
    seed: 1,
    threads: Math.max(1, availableParallelism() - 2),
    maxMoves: 200,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, val] = [argv[i], argv[i + 1]];
    if (val === undefined) throw new Error(`Değer eksik: ${k}`);
    switch (k) {
      case '--a': o.a = val; break;
      case '--b': o.b = val; break;
      case '--level-a': o.levelA = Number(val); break;
      case '--level-b': o.levelB = Number(val); break;
      case '--level': o.levelA = o.levelB = Number(val); break;
      case '--time-a': o.timeA = Number(val); break;
      case '--time-b': o.timeB = Number(val); break;
      case '--time': o.timeA = o.timeB = Number(val); break;
      case '--games': o.games = Number(val); break;
      case '--variant': o.variant = val; break;
      case '--seed': o.seed = Number(val); break;
      case '--threads': o.threads = Number(val); break;
      case '--max-moves': o.maxMoves = Number(val); break;
      default: throw new Error(`Bilinmeyen seçenek: ${k}`);
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// Worker: plays the games it is sent

async function workerMain(o: Options): Promise<void> {
  const A = await loadEngine(o.a);
  const B = o.b === o.a ? A : await loadEngine(o.b);
  const vA = A.engine.getVariant(o.variant);
  const vB = B.engine.getVariant(o.variant);

  parentPort!.on('message', (job: Job | null) => {
    if (job === null) process.exit(0);
    parentPort!.postMessage(playGame(job));
  });
  parentPort!.postMessage('ready');

  function playGame(job: Job): GameResult {
    const rng = A.rng.createRng(o.seed * 100_003 + job.opening);
    let sa = A.engine.createGame(vA);
    let sb = B.engine.createGame(vB);
    const apply = (from: number, to: number, promotion: string | undefined) => {
      sa = A.engine.makeMove(vA, sa, A.engine.findMove(vA, sa, from, to, promotion)!);
      sb = B.engine.makeMove(vB, sb, B.engine.findMove(vB, sb, from, to, promotion)!);
    };
    // Opening: 4 random plies (same for both colour assignments).
    for (let i = 0; i < 4 && !sa.result; i++) {
      const m = rng.pick(A.engine.legalMoves(vA, sa.position));
      apply(m.from, m.to, m.promotion);
    }
    let plies = 0;
    while (!sa.result && sa.position.fullmove <= o.maxMoves) {
      const aToMove = (sa.position.turn === 'w') === job.aWhite;
      const m = aToMove
        ? A.search.chooseMove(vA, sa, o.levelA, { seed: plies + 1, timeLimitMs: o.timeA }).move
        : B.search.chooseMove(vB, sb, o.levelB, { seed: plies + 1, timeLimitMs: o.timeB }).move;
      apply(m.from, m.to, m.promotion);
      plies++;
    }
    const r = sa.result;
    if (!r) return { score: 0.5, reason: 'limit', plies };
    if (r.winner === null) return { score: 0.5, reason: r.reason, plies };
    const aWon = (r.winner === 'w') === job.aWhite;
    return { score: aWon ? 1 : 0, reason: r.reason, plies };
  }
}

// ---------------------------------------------------------------------------
// Main: distributes games, prints the result

function elo(score: number): number {
  const s = Math.min(Math.max(score, 1e-6), 1 - 1e-6);
  return -400 * Math.log10(1 / s - 1);
}

async function main(o: Options): Promise<void> {
  const jobs: Job[] = [];
  for (let g = 0; g < o.games; g++) jobs.push({ opening: Math.floor(g / 2), aWhite: g % 2 === 0 });
  const results: GameResult[] = [];
  const t0 = Date.now();
  console.log(
    `Maç: A=${o.a} (seviye ${o.levelA}, ${o.timeA} ms) – B=${o.b} (seviye ${o.levelB}, ${o.timeB} ms), ` +
      `${o.variant}, ${o.games} oyun, ${o.threads} iş parçacığı`,
  );
  await new Promise<void>((done, fail) => {
    let next = 0;
    let running = 0;
    const self = new URL(import.meta.url);
    for (let i = 0; i < Math.min(o.threads, jobs.length); i++) {
      const w = new Worker(self, { workerData: o });
      running++;
      w.on('message', (msg: GameResult | 'ready') => {
        if (msg !== 'ready') {
          results.push(msg);
          if (results.length % 10 === 0 || results.length === jobs.length) {
            const s = results.reduce((a, r) => a + r.score, 0) / results.length;
            process.stdout.write(`\r${results.length}/${jobs.length} oyun, A puanı %${(s * 100).toFixed(1)}   `);
          }
        }
        w.postMessage(next < jobs.length ? jobs[next++] : null);
      });
      w.on('error', fail);
      w.on('exit', () => {
        if (--running === 0) done();
      });
    }
  });
  const n = results.length;
  const wins = results.filter((r) => r.score === 1).length;
  const losses = results.filter((r) => r.score === 0).length;
  const draws = n - wins - losses;
  const score = (wins + draws / 2) / n;
  // 95% margin from the per-game score variance.
  const variance = results.reduce((a, r) => a + (r.score - score) ** 2, 0) / n;
  const se = Math.sqrt(variance / n);
  const margin = (elo(Math.min(0.999, score + 1.96 * se)) - elo(Math.max(0.001, score - 1.96 * se))) / 2;
  const reasons: Record<string, number> = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  console.log(
    `\nA: +${wins} =${draws} -${losses}  puan %${(score * 100).toFixed(1)}  ` +
      `Elo farkı ${elo(score) >= 0 ? '+' : ''}${elo(score).toFixed(0)} ± ${margin.toFixed(0)}`,
  );
  console.log(
    `Bitişler: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}; ort. ${(
      results.reduce((a, r) => a + r.plies, 0) / n
    ).toFixed(0)} ply; ${((Date.now() - t0) / 1000).toFixed(0)} sn`,
  );
}

if (isMainThread) await main(parseArgs(process.argv.slice(2)));
else await workerMain(workerData as Options);
