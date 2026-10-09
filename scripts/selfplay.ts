// Bot vs bot simulation from the command line, for balancing variants.
//
//   npm run selfplay -- --variant jester --games 100 --white 3 --black 3 --seed 1 [--out sonuc.json]
//
// Runs in Node without a worker, using the same /src/ai code as the app.
// --variant all plays every registered variant.

import { writeFileSync } from 'node:fs';
import { getVariant, listVariants, parseFen } from '../src/engine/index.ts';
import type { VariantDefinition } from '../src/engine/index.ts';
import { playMatch } from '../src/ai/match.ts';
import type { MatchReason } from '../src/ai/match.ts';

interface Args {
  variant: string;
  games: number;
  white: number;
  black: number;
  seed: number;
  maxMoves: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { variant: 'standard', games: 20, white: 2, black: 2, seed: 1, maxMoves: 200 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[++i];
    if (val === undefined) throw new Error(`Değer eksik: ${key}`);
    switch (key) {
      case '--variant': args.variant = val; break;
      case '--games': args.games = Number(val); break;
      case '--white': args.white = Number(val); break;
      case '--black': args.black = Number(val); break;
      case '--seed': args.seed = Number(val); break;
      case '--max-moves': args.maxMoves = Number(val); break;
      case '--out': args.out = val; break;
      default: throw new Error(`Bilinmeyen seçenek: ${key}`);
    }
  }
  return args;
}

const STANDARD_TYPES = new Set(['p', 'n', 'b', 'r', 'q', 'k']);

export interface VariantSummary {
  variant: string;
  games: number;
  white: number;
  black: number;
  whiteWinPct: number;
  blackWinPct: number;
  drawPct: number;
  /** White's score in percent (win = 1, draw = ½). */
  whiteScorePct: number;
  avgFullMoves: number;
  reasons: Record<string, number>;
  /** Special pieces captured / special pieces at the start, over all games (null: variant has none). */
  specialCaptureRatePct: number | null;
  avgSpecialCaptureMove: number | null;
  ms: number;
}

const REASON_NAMES: Record<MatchReason, string> = {
  checkmate: 'mat',
  stalemate: 'pat',
  threefold: 'tekrar',
  'fifty-move': '50 hamle',
  insufficient: 'materyal',
  limit: 'sınır',
};

function runVariant(v: VariantDefinition, args: Args): VariantSummary {
  const start = performance.now();
  const specialsAtStart = parseFen(v, v.startPosition).board.filter((p) => p && !STANDARD_TYPES.has(p.type)).length;
  let whiteWins = 0;
  let blackWins = 0;
  let fullMoves = 0;
  const reasons: Record<string, number> = {};
  const captureMoves: number[] = [];

  for (let i = 0; i < args.games; i++) {
    const r = playMatch(v, { white: args.white, black: args.black, seed: args.seed + i, maxFullMoves: args.maxMoves });
    if (r.winner === 'w') whiteWins++;
    if (r.winner === 'b') blackWins++;
    const name = REASON_NAMES[r.reason];
    reasons[name] = (reasons[name] ?? 0) + 1;
    fullMoves += Math.ceil(r.plies / 2);
    for (const c of r.specialCaptures) captureMoves.push(c.fullmove);
    process.stdout.write('.');
  }

  const pct = (n: number) => Math.round((n / args.games) * 1000) / 10;
  const draws = args.games - whiteWins - blackWins;
  return {
    variant: v.id,
    games: args.games,
    white: args.white,
    black: args.black,
    whiteWinPct: pct(whiteWins),
    blackWinPct: pct(blackWins),
    drawPct: pct(draws),
    whiteScorePct: pct(whiteWins + draws / 2),
    avgFullMoves: Math.round((fullMoves / args.games) * 10) / 10,
    reasons,
    specialCaptureRatePct: specialsAtStart ? Math.round((captureMoves.length / (specialsAtStart * args.games)) * 1000) / 10 : null,
    avgSpecialCaptureMove: captureMoves.length
      ? Math.round((captureMoves.reduce((a, b) => a + b, 0) / captureMoves.length) * 10) / 10
      : null,
    ms: Math.round(performance.now() - start),
  };
}

function printTable(rows: VariantSummary[]): void {
  console.table(
    Object.fromEntries(
      rows.map((r) => [
        r.variant,
        {
          oyun: r.games,
          'beyaz %': r.whiteWinPct,
          'siyah %': r.blackWinPct,
          'beraberlik %': r.drawPct,
          'ort. hamle': r.avgFullMoves,
          bitişler: Object.entries(r.reasons).map(([k, n]) => `${k} ${n}`).join(', '),
          'özel taş yenme %': r.specialCaptureRatePct ?? '-',
          'ort. yenme hamlesi': r.avgSpecialCaptureMove ?? '-',
          'süre (sn)': Math.round(r.ms / 100) / 10,
        },
      ]),
    ),
  );
}

const args = parseArgs(process.argv.slice(2));
const variants = args.variant === 'all' ? listVariants() : [getVariant(args.variant)];
console.log(`Bot vs bot: beyaz seviye ${args.white}, siyah seviye ${args.black}, ${args.games} oyun/varyant, tohum ${args.seed}`);
const rows: VariantSummary[] = [];
for (const v of variants) {
  process.stdout.write(`${v.id} `);
  rows.push(runVariant(v, args));
  process.stdout.write('\n');
}
printTable(rows);
console.log('İlk 2 hamle (her renk 1) rastgele; 200 hamlede bitmeyen oyunlar "sınır" beraberliği sayılır.');
if (args.out) {
  writeFileSync(args.out, JSON.stringify({ args, results: rows }, null, 2));
  console.log(`Sonuçlar yazıldı: ${args.out}`);
}
