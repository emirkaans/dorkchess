// Calibration: our engine (level 5, its real time limit) against Stockfish
// limited with UCI_LimitStrength / UCI_Elo, standard chess only. Development
// tool: Stockfish is a local binary (not part of the app).
//
//   npm run sf-match -- --sf data/stockfish/stockfish/stockfish-windows-x86-64-universal.exe --elo 2300 --games 60
//
// Openings: random 4-ply sequences, each played twice with colours swapped.

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import {
  createGame,
  findMove,
  getVariant,
  legalMoves,
  makeMove,
  squareName,
  parseSquare,
} from '../src/engine/index.ts';
import type { GameState } from '../src/engine/index.ts';
import { chooseMove } from '../src/ai/search.ts';
import { createRng } from '../src/ai/rng.ts';
import { levelConfig } from '../src/ai/levels.ts';

interface Options {
  sf: string;
  elo: number;
  games: number;
  level: number;
  /** Our time per move (default: the level's limit); Stockfish gets the same as movetime. */
  time: number;
  threads: number;
  seed: number;
}

interface Job {
  opening: number;
  ourWhite: boolean;
}

interface Result {
  score: number;
  reason: string;
  plies: number;
  ourDepth: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    sf: 'data/stockfish/stockfish/stockfish-windows-x86-64-universal.exe',
    elo: 2300,
    games: 60,
    level: 5,
    time: 0,
    threads: Math.max(1, availableParallelism() - 4),
    seed: 1,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--sf') o.sf = v;
    else if (k === '--elo') o.elo = Number(v);
    else if (k === '--games') o.games = Number(v);
    else if (k === '--level') o.level = Number(v);
    else if (k === '--time') o.time = Number(v);
    else if (k === '--threads') o.threads = Number(v);
    else if (k === '--seed') o.seed = Number(v);
    else throw new Error(`Bilinmeyen seçenek: ${k}`);
  }
  if (!o.time) o.time = levelConfig(o.level).timeLimitMs;
  return o;
}

/** Minimal UCI driver. */
class Uci {
  private readonly proc: ChildProcessWithoutNullStreams;
  private waiters: { test: (l: string) => boolean; resolve: (l: string) => void }[] = [];

  constructor(path: string) {
    this.proc = spawn(path, [], { stdio: 'pipe' });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const i = this.waiters.findIndex((w) => w.test(line));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(line);
    });
  }

  send(cmd: string): void {
    this.proc.stdin.write(cmd + '\n');
  }

  waitFor(test: (l: string) => boolean): Promise<string> {
    return new Promise((resolve) => this.waiters.push({ test, resolve }));
  }

  async init(elo: number): Promise<void> {
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 16');
    this.send('setoption name UCI_LimitStrength value true');
    this.send(`setoption name UCI_Elo value ${elo}`);
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  async bestMove(moves: string[], movetime: number): Promise<string> {
    this.send(`position startpos${moves.length ? ' moves ' + moves.join(' ') : ''}`);
    this.send(`go movetime ${movetime}`);
    const line = await this.waitFor((l) => l.startsWith('bestmove'));
    return line.split(' ')[1];
  }

  quit(): void {
    this.send('quit');
  }
}

async function workerMain(o: Options): Promise<void> {
  const v = getVariant('standard');
  const sf = new Uci(o.sf);
  await sf.init(o.elo);

  const play = async (job: Job): Promise<Result> => {
    sf.send('ucinewgame');
    const rng = createRng(o.seed * 100_003 + job.opening);
    let state: GameState = createGame(v);
    const uci: string[] = [];
    const apply = (from: number, to: number, promo?: string) => {
      const m = findMove(v, state, from, to, promo);
      if (!m) throw new Error(`Geçersiz hamle ${squareName(from)}${squareName(to)}${promo ?? ''}`);
      state = makeMove(v, state, m);
      uci.push(squareName(from) + squareName(to) + (promo ?? ''));
    };
    for (let i = 0; i < 4; i++) {
      const m = rng.pick(legalMoves(v, state.position));
      apply(m.from, m.to, m.promotion);
    }
    let plies = 0;
    let depthSum = 0;
    let ourMoves = 0;
    while (!state.result && state.position.fullmove <= 200) {
      const ourTurn = (state.position.turn === 'w') === job.ourWhite;
      if (ourTurn) {
        const r = chooseMove(v, state, o.level, { seed: plies + 1, timeLimitMs: o.time });
        depthSum += r.depth;
        ourMoves++;
        apply(r.move.from, r.move.to, r.move.promotion);
      } else {
        const best = await sf.bestMove(uci, o.time);
        apply(parseSquare(best.slice(0, 2)), parseSquare(best.slice(2, 4)), best[4]);
      }
      plies++;
    }
    const res = state.result;
    const depth = ourMoves ? depthSum / ourMoves : 0;
    if (!res || res.winner === null) return { score: 0.5, reason: res?.reason ?? 'limit', plies, ourDepth: depth };
    return { score: (res.winner === 'w') === job.ourWhite ? 1 : 0, reason: res.reason, plies, ourDepth: depth };
  };

  parentPort!.on('message', async (job: Job | null) => {
    if (job === null) {
      sf.quit();
      process.exit(0);
    }
    parentPort!.postMessage(await play(job));
  });
  parentPort!.postMessage('ready');
}

const elo = (s: number) => -400 * Math.log10(1 / Math.min(Math.max(s, 1e-6), 1 - 1e-6) - 1);

async function main(o: Options): Promise<void> {
  const jobs: Job[] = Array.from({ length: o.games }, (_, g) => ({
    opening: Math.floor(g / 2),
    ourWhite: g % 2 === 0,
  }));
  const results: Result[] = [];
  const t0 = Date.now();
  console.log(
    `Kalibrasyon: seviye ${o.level} (${o.time} ms) – Stockfish UCI_Elo ${o.elo} (${o.time} ms), ${o.games} oyun, ${o.threads} iş parçacığı`,
  );
  await new Promise<void>((done, fail) => {
    let next = 0;
    let running = 0;
    for (let i = 0; i < Math.min(o.threads, jobs.length); i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: o });
      running++;
      w.on('message', (msg: Result | 'ready') => {
        if (msg !== 'ready') {
          results.push(msg);
          const s = results.reduce((a, r) => a + r.score, 0) / results.length;
          process.stdout.write(`\r${results.length}/${jobs.length} oyun, bizim puan %${(s * 100).toFixed(1)}   `);
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
  const variance = results.reduce((a, r) => a + (r.score - score) ** 2, 0) / n;
  const se = Math.sqrt(variance / n);
  const lo = elo(Math.max(0.001, score - 1.96 * se));
  const hi = elo(Math.min(0.999, score + 1.96 * se));
  const reasons: Record<string, number> = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  console.log(
    `\nBiz: +${wins} =${draws} -${losses}, puan %${(score * 100).toFixed(1)} → ` +
      `tahmini güç ≈ ${Math.round(o.elo + elo(score))} (95%: ${Math.round(o.elo + lo)}–${Math.round(o.elo + hi)})`,
  );
  console.log(
    `Bitişler: ${Object.entries(reasons)
      .map(([k, c]) => `${k} ${c}`)
      .join(', ')}; ` +
      `ort. derinliğimiz ${(results.reduce((a, r) => a + r.ourDepth, 0) / n).toFixed(1)}; ${((Date.now() - t0) / 60000).toFixed(1)} dk`,
  );
}

if (isMainThread) await main(parseArgs(process.argv.slice(2)));
else await workerMain(workerData as Options);
