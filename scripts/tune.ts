// Texel tuning: fits the evaluation parameters to game results.
//   npm run tune -- --data data/standard.txt[,data/jester.txt] [--epochs 3000] [--write]
//
// Each line of the data files is "<fen>|<result>" (see gen-data.ts; the
// variant is given per file as "variant:path", default standard). The error
// is the mean squared difference between the result and sigmoid(K * eval);
// K is fitted first, then the parameters are optimised with Adam on the full
// batch while a 10% hold-out set guards against over-fitting. With --write,
// src/ai/eval-params.ts is regenerated from the best parameters.

import { readFileSync, writeFileSync } from 'node:fs';
import { FastBoard } from '../src/engine/fast/board.ts';
import { getVariant, parseFen } from '../src/engine/index.ts';
import { EVAL_PARAMS } from '../src/ai/eval-params.ts';
import type { EvalParams } from '../src/ai/eval-params.ts';
import { PARAM_COUNT, features, fromVector, isFrozen, linearEval, toVector } from '../src/ai/eval-features.ts';
import { phaseWeight } from '../src/ai/evaluate.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const sources = arg('--data', 'standard:data/standard.txt').split(',');
const epochs = Number(arg('--epochs', '3000'));
const write = args.includes('--write');
/** L2 pull towards the starting parameters (keeps rarely seen squares and mid/end-game pairs sane). */
const lambda = Number(arg('--lambda', '1e-7'));
const lr = Number(arg('--lr', '0.5'));
/**
 * Weight of the Stockfish evaluation in the target (lines "<fen>|<result>|<cp>",
 * see sf-label.ts): target = w * sigmoid(k * cp) + (1 - w) * result. With w > 0
 * the sigmoid scale k is fixed (--k, default = Texel K 1) instead of fitted.
 */
const sfWeight = Number(arg('--sf-weight', '0'));
const fixedK = Number(arg('--k', String(Math.LN10 / 400)));

// --- load data into flat sparse arrays ---
const idx: number[] = [];
const coef: number[] = [];
const start: number[] = [0];
const constant: number[] = [];
const result: number[] = [];
for (const src of sources) {
  const [variantId, path] = src.includes(':') && !/^[a-zA-Z]:[\\/]/.test(src) ? src.split(/:(.+)/) : ['standard', src];
  const v = getVariant(variantId);
  const b = new FastBoard(v);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    const [fen, res, cp] = line.split('|');
    if (sfWeight > 0 && cp === undefined) throw new Error(`Stockfish puanı yok: ${path}`);
    b.load(parseFen(v, fen));
    const f = features(b, EVAL_PARAMS, phaseWeight);
    for (let k = 0; k < f.index.length; k++) {
      idx.push(f.index[k]);
      coef.push(f.coef[k]);
    }
    start.push(idx.length);
    constant.push(f.constant);
    const sfTarget = sfWeight > 0 ? 1 / (1 + Math.exp(-fixedK * Math.max(-2000, Math.min(2000, Number(cp))))) : 0;
    result.push(sfWeight * sfTarget + (1 - sfWeight) * Number(res));
  }
  console.log(`${variantId}: ${path} okundu, toplam ${result.length} konum`);
}
const N = result.length;
const I = Int32Array.from(idx);
const C = Float64Array.from(coef);
const S = Int32Array.from(start);
const K0 = Float64Array.from(constant);
const R = Float64Array.from(result);
// Deterministic hold-out: every 10th position.
const isVal = (i: number) => i % 10 === 0;

function scores(v: Float64Array, out: Float64Array): void {
  for (let i = 0; i < N; i++) {
    let s = K0[i];
    for (let k = S[i]; k < S[i + 1]; k++) s += C[k] * v[I[k]];
    out[i] = s;
  }
}

const sig = (s: number, k: number) => 1 / (1 + Math.exp(-k * s));
function error(sc: Float64Array, k: number, val: boolean): number {
  let e = 0;
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (isVal(i) !== val) continue;
    const d = R[i] - sig(sc[i], k);
    e += d * d;
    n++;
  }
  return e / n;
}

// --- fit K (sigmoid scale) for the starting parameters ---
let vec = toVector(EVAL_PARAMS);
const start0 = vec.slice();
const sc = new Float64Array(N);
scores(vec, sc);
let bestK = 0.01;
let bestE = Infinity;
for (let k = 0.001; k <= 0.03; k += 0.0005) {
  const e = error(sc, k, false);
  if (e < bestE) [bestE, bestK] = [e, k];
}
const K = sfWeight > 0 ? fixedK : bestK;
if (sfWeight > 0) bestE = error(sc, K, false);
console.log(`K = ${K.toFixed(4)} (≈ ${(K * 400 / Math.LN10).toFixed(2)} Texel ölçeğinde), başlangıç hatası eğitim ${bestE.toFixed(5)} / doğrulama ${error(sc, K, true).toFixed(5)}`);

// --- Adam ---
const m = new Float64Array(PARAM_COUNT);
const vv = new Float64Array(PARAM_COUNT);
const grad = new Float64Array(PARAM_COUNT);
const [b1, b2, eps] = [0.9, 0.999, 1e-8];
let best = vec.slice();
let bestVal = error(sc, K, true);
let sinceBest = 0;
for (let ep = 1; ep <= epochs; ep++) {
  scores(vec, sc);
  grad.fill(0);
  let nTrain = 0;
  for (let i = 0; i < N; i++) {
    if (isVal(i)) continue;
    nTrain++;
    const p = sig(sc[i], K);
    const g = -2 * (R[i] - p) * p * (1 - p) * K;
    for (let k = S[i]; k < S[i + 1]; k++) grad[I[k]] += g * C[k];
  }
  for (let j = 0; j < PARAM_COUNT; j++) {
    if (isFrozen(j)) continue;
    const g = grad[j] / nTrain + 2 * lambda * (vec[j] - start0[j]);
    m[j] = b1 * m[j] + (1 - b1) * g;
    vv[j] = b2 * vv[j] + (1 - b2) * g * g;
    const mh = m[j] / (1 - b1 ** ep);
    const vh = vv[j] / (1 - b2 ** ep);
    vec[j] -= (lr * mh) / (Math.sqrt(vh) + eps);
  }
  if (ep % 50 === 0 || ep === epochs) {
    scores(vec, sc);
    const tr = error(sc, K, false);
    const va = error(sc, K, true);
    if (va < bestVal - 1e-7) {
      bestVal = va;
      best = vec.slice();
      sinceBest = 0;
    } else sinceBest += 50;
    console.log(`tur ${ep}: eğitim ${tr.toFixed(5)}  doğrulama ${va.toFixed(5)}`);
    if (sinceBest >= 400) {
      console.log('Doğrulama hatası iyileşmiyor; duruyorum.');
      break;
    }
  }
}
vec = best;
console.log(`En iyi doğrulama hatası: ${bestVal.toFixed(5)}`);

if (write) {
  const p = fromVector(vec, EVAL_PARAMS);
  writeFileSync('src/ai/eval-params.ts', render(p));
  console.log('src/ai/eval-params.ts yazıldı.');
}

function render(p: EvalParams): string {
  const src = readFileSync('src/ai/eval-params.ts', 'utf8');
  const head = src.slice(0, src.indexOf('// prettier-ignore\nexport const EVAL_PARAMS'));
  const arr = (a: readonly number[]) => `[${a.join(', ')}]`;
  const table = (t: Record<string, number[]>) =>
    Object.entries(t)
      .map(([k, a]) => `    ${k}: [\n${Array.from({ length: 8 }, (_, r) => '      ' + a.slice(r * 8, r * 8 + 8).map((x) => String(x).padStart(4)).join(',') + ',').join('\n')}\n    ],`)
      .join('\n');
  return `${head}// prettier-ignore
export const EVAL_PARAMS: EvalParams = {
  tempo: ${p.tempo},
  bishopPair: ${arr(p.bishopPair)},
  doubledPawn: ${arr(p.doubledPawn)},
  isolatedPawn: ${arr(p.isolatedPawn)},
  passedMg: ${arr(p.passedMg)},
  passedEg: ${arr(p.passedEg)},
  rookOpenFile: ${arr(p.rookOpenFile)},
  rookSemiOpenFile: ${arr(p.rookSemiOpenFile)},
  mobility: { ${Object.entries(p.mobility).map(([k, a]) => `${k}: ${arr(a)}`).join(', ')} },
  mobilityBase: { ${Object.entries(p.mobilityBase).map(([k, a]) => `${k}: ${a}`).join(', ')} },
  kingShieldMissing: ${p.kingShieldMissing},
  kingAttack: { ${Object.entries(p.kingAttack).map(([k, a]) => `${k}: ${a}`).join(', ')} },
  kingAttackScale: ${arr(p.kingAttackScale)},
  threatByPawn: ${arr(p.threatByPawn)},
  pstMg: {
${table(p.pstMg)}
  },
  pstEg: {
${table(p.pstEg)}
  },
};
`;
}
void linearEval;
