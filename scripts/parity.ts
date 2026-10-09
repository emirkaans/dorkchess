// Deep (slow) engine parity check: perft at a chosen depth on positions from
// random games of every variant, fast board vs reference engine. Not part of
// `npm test`; run before releases or after changing move generation.
//
//   npm run parity -- --depth 4 --positions 20 [--variant jester]

import { FastBoard } from '../src/engine/fast/board.ts';
import { perft } from '../src/engine/legality.ts';
import { toFen } from '../src/engine/notation.ts';
import { getVariant, listVariants } from '../src/engine/variants/index.ts';
import { allStarts, lockstep } from '../tests/engine-parity.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const depth = Number(arg('--depth', '4'));
const count = Number(arg('--positions', '20'));
const only = arg('--variant', '');

let failures = 0;
for (const v of only ? [getVariant(only)] : listVariants()) {
  const t0 = Date.now();
  const run = lockstep(v, allStarts(v), 30, 99);
  failures += run.errors.length;
  for (const e of run.errors) console.log(`  ✗ ${e}`);
  const step = Math.max(1, Math.floor(run.positions.length / count));
  const b = new FastBoard(v);
  let checked = 0;
  for (let i = 0; i < run.positions.length && checked < count; i += step, checked++) {
    const pos = run.positions[i];
    b.load(pos);
    const fast = b.perft(depth);
    const ref = perft(v, pos, depth);
    if (fast !== ref) {
      failures++;
      console.log(`  ✗ ${v.id} perft(${depth}) ${toFen(v, pos)}: hızlı ${fast}, motor ${ref}`);
    }
  }
  console.log(
    `${v.id}: ${run.positions.length} konum kilit adımlı, ${checked} konumda perft(${depth}) — ${((Date.now() - t0) / 1000).toFixed(0)} sn`,
  );
}
console.log(failures ? `${failures} uyumsuzluk bulundu.` : 'Uyumsuzluk yok.');
process.exit(failures ? 1 : 0);
