// Labels training positions with Stockfish evaluations (development tool,
// for tuning only; Stockfish is a local binary, not part of the app).
//   npm run sf-label -- --in data/standard.txt --out data/standard-sf.txt --count 100000 --depth 8
// Output lines: "<fen>|<result>|<stockfish centipawns, White's view>".
// Positions where Stockfish reports a mate are skipped.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { availableParallelism } from 'node:os';
import { createRng } from '../src/ai/rng.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const input = arg('--in', 'data/standard.txt');
const output = arg('--out', 'data/standard-sf.txt');
const count = Number(arg('--count', '100000'));
const depth = Number(arg('--depth', '8'));
const procs = Number(arg('--procs', String(Math.max(1, availableParallelism() - 2))));
const sfPath = arg('--sf', 'data/stockfish/stockfish/stockfish-windows-x86-64-universal.exe');

const lines = readFileSync(input, 'utf8').split('\n').filter(Boolean);
// Deterministic sample without replacement.
const rng = createRng(12345);
for (let i = lines.length - 1; i > 0; i--) {
  const j = rng.int(i + 1);
  [lines[i], lines[j]] = [lines[j], lines[i]];
}
const sample = lines.slice(0, Math.min(count, lines.length));
writeFileSync(output, '');

let next = 0;
let done = 0;
let skipped = 0;
const t0 = Date.now();
const buffer: string[] = [];

async function worker(): Promise<void> {
  const sf = spawn(sfPath, [], { stdio: 'pipe' });
  const rl = createInterface({ input: sf.stdout });
  let waiting: ((l: string) => void) | null = null;
  let lastScore: string | null = null;
  rl.on('line', (l) => {
    if (l.startsWith('info') && l.includes(' score ')) lastScore = l;
    if (waiting && (l === 'uciok' || l === 'readyok' || l.startsWith('bestmove'))) {
      const w = waiting;
      waiting = null;
      w(l);
    }
  });
  const ask = (cmd: string) =>
    new Promise<string>((resolve) => {
      waiting = resolve;
      sf.stdin.write(cmd + '\n');
    });
  await ask('uci');
  sf.stdin.write('setoption name Threads value 1\nsetoption name Hash value 16\n');
  await ask('isready');
  while (next < sample.length) {
    const line = sample[next++];
    const [fen, result] = line.split('|');
    lastScore = null;
    await ask(`position fen ${fen}\ngo depth ${depth}`);
    const m = (lastScore as string | null)?.match(/score (cp|mate) (-?\d+)/);
    done++;
    if (!m || m[1] === 'mate') {
      skipped++;
      continue;
    }
    // Stockfish scores are from the side to move's view.
    const stm = fen.split(' ')[1];
    const cp = Number(m[2]) * (stm === 'w' ? 1 : -1);
    buffer.push(`${fen}|${result}|${cp}`);
    if (buffer.length >= 2000) appendFileSync(output, buffer.splice(0).join('\n') + '\n');
    if (done % 5000 === 0) console.log(`${done}/${sample.length} (${skipped} mat atlandı), ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  }
  sf.stdin.write('quit\n');
}

await Promise.all(Array.from({ length: procs }, () => worker()));
if (buffer.length) appendFileSync(output, buffer.join('\n') + '\n');
console.log(`Bitti: ${done - skipped} konum yazıldı (${skipped} atlandı), ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
