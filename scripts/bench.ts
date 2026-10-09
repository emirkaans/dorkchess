// npm run bench — perft(4) from the start position, then how deep level 5 gets
// in 3 seconds on a typical middlegame position, and nodes per second.

import { createGame, getVariant, parseFen, perft } from '../src/engine/index.ts';
import { chooseMove } from '../src/ai/search.ts';
import { levelConfig } from '../src/ai/levels.ts';

const MIDDLEGAME = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w KQ - 0 8';
const v = getVariant('standard');

let t = performance.now();
const leaves = perft(v, parseFen(v, v.startPosition), 4);
const perftMs = performance.now() - t;
console.log(`perft(4) başlangıç: ${leaves} yaprak, ${perftMs.toFixed(0)} ms (${Math.round(leaves / (perftMs / 1000)).toLocaleString('tr-TR')} yaprak/sn)`);

const cfg = levelConfig(5);
t = performance.now();
const r = chooseMove(v, createGame(v, MIDDLEGAME), 5, { seed: 1 });
const searchMs = performance.now() - t;
console.log(
  `seviye 5 (${cfg.name}), ${cfg.timeLimitMs / 1000} sn, oyun ortası: derinlik ${r.depth}, ` +
    `${r.nodes.toLocaleString('tr-TR')} düğüm, ${Math.round(r.nodes / (searchMs / 1000)).toLocaleString('tr-TR')} düğüm/sn, ` +
    `${searchMs.toFixed(0)} ms`,
);
console.log(r.depth >= 4 ? 'Hedef (≥ 4 ply) karşılandı.' : 'UYARI: hedef derinlik (4 ply) karşılanmadı.');
