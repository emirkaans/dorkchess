import { ALL_DIRS, offset, rankOf } from '../board.ts';
import type { Color, MovePattern, PieceDefinition, Position, Square } from '../types.ts';
import { SLAB_BASE, glyphStyleSvg } from './icons.ts';
import { STANDARD_PIECES, STANDARD_VALUES, defineVariant, fixedPatterns } from './standard.ts';

/** Ranks (0-based: 3 = rank 4, 4 = rank 5) where a Diplomat's peace zone is active and can reach. */
export const AURA_RANKS: readonly number[] = [3, 4];

const onAuraRank = (sq: Square) => AURA_RANKS.includes(rankOf(sq));

/** One step in any direction, empty squares only (the Diplomat never captures). */
const DIPLOMAT_STEP: MovePattern = { kind: 'step', dirs: ALL_DIRS };

/** Flag on a pole, drawn in the glyph style (see icons.ts). */
const diplomatSvg = glyphStyleSvg([
  SLAB_BASE,
  'M640 1552 V1490 H850 V1552 Z M700 1490 V330 H790 V1490 Z M670 270 A75 75 0 1 0 820 270 A75 75 0 1 0 670 270 Z',
  'M790 360 C1000 290 1180 450 1470 370 V850 C1180 930 1000 770 790 840 Z M850 575 C1020 520 1190 660 1410 590 V640 C1190 710 1020 570 850 625 Z',
]);

/**
 * Is `sq` in a peace zone? A zone is active only while its Diplomat stands on
 * rank 4 or 5, and covers the adjacent squares that are themselves on rank 4
 * or 5 (never the Diplomat's own square). Zones of several Diplomats merge.
 */
export function inAura(pos: Position, sq: Square): boolean {
  if (!onAuraRank(sq)) return false;
  return ALL_DIRS.some((dir) => {
    const n = offset(sq, dir);
    return n !== -1 && onAuraRank(n) && pos.board[n]?.type === 'd';
  });
}

/** All peace-zone squares of the position. */
export function auraSquares(pos: Position): Square[] {
  const out: Square[] = [];
  for (let sq = 0; sq < 64; sq++) if (inAura(pos, sq)) out.push(sq);
  return out;
}

/** Bot evaluation: +30 for each own active Diplomat, +10 for each own piece in its zone. */
function zoneBonus(pos: Position, color: Color): number {
  let bonus = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p?.type !== 'd' || p.color !== color || !onAuraRank(sq)) continue;
    bonus += 30;
    for (const dir of ALL_DIRS) {
      const n = offset(sq, dir);
      if (n !== -1 && onAuraRank(n) && pos.board[n]?.color === color) bonus += 10;
    }
  }
  return bonus;
}

export const DIPLOMAT: PieceDefinition = {
  type: 'd',
  name: 'Diplomat',
  fenChar: 'd',
  sanLetter: 'D',
  patterns: fixedPatterns(DIPLOMAT_STEP),
  canCapture: false,
  capturable: true,
  material: 'none',
  icon: { kind: 'svg', svg: diplomatSvg },
  inactive: (_pos, sq) => !onAuraRank(sq),
};

export const diplomat = defineVariant({
  id: 'diplomat',
  name: 'Diplomat',
  description: [
    "g1/g8'deki atların yerine Diplomat (D) başlar.",
    'Diplomat her yöne 1 kare, yalnızca boş kareye gider; yeme yapmaz, şah çekmez.',
    'Barış bölgesi (aura) yalnızca Diplomat 4. veya 5. yataydayken aktiftir: bitişik kareler, ama sadece 4. ve 5. yataydakiler.',
    'Aurada duran taş yenemez; şah hariç (şah aurada da şah çekilebilir ve mat olabilir).',
    'Aurada duran taş (şah dahil) yeme yapamaz; en passant da buna uyar.',
    'Diplomat yenebilir, ama yalnızca aura dışından gelen bir taşla; yenince aurası kalkar.',
    "Piyon Diplomat'a terfi edemez.",
  ],
  startPosition: 'rnbqkbdr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBDR w KQkq - 0 1',
  pieces: { ...STANDARD_PIECES, d: DIPLOMAT },
  promotionTypes: ['q', 'r', 'b', 'n'],
  pieceValues: { ...STANDARD_VALUES, d: 200 },
  evaluateExtra: zoneBonus,
  rules: {
    title: 'Diplomat',
    summary: "g1/g8'deki atların yerine Diplomat başlar. 4. veya 5. yataydayken çevresinde barış bölgesi kurar.",
    bullets: [
      'Her yöne 1 kare, yalnızca boş kareye gider; yeme yapmaz, şah çekmez.',
      'Barış bölgesi: bitişik kareler, ama yalnızca 4. ve 5. yataydakiler.',
      'Bölgede duran taş yenemez (şah hariç) ve kendisi de yeme yapamaz.',
      'Diplomat yenebilir, ama yalnızca bölge dışından gelen bir taşla.',
      'En passant da bölge kuralına uyar.',
    ],
    examples: [
      {
        fen: '4k3/8/8/8/3D4/8/8/4K3 w - - 0 1',
        highlights: ['c4', 'e4', 'c5', 'd5', 'e5'],
        arrows: [],
        caption: "Diplomat d4'te: barış bölgesi c4, e4, c5, d5, e5. 3. yataya taşmaz.",
      },
      {
        fen: '7k/8/8/3R3n/3D4/8/8/K7 w - - 0 1',
        highlights: ['d5'],
        arrows: [['d5', 'h5']],
        caption: "d5'teki kale bölgede: h5'teki atı yiyemez. Bölgedeki taşlar da yenemez.",
      },
      {
        fen: '4k3/8/8/8/8/3Dn3/8/4R1K1 w - - 0 1',
        highlights: ['d3'],
        arrows: [['e1', 'e3']],
        caption: "Diplomat 3. yatayda: bölgesi yok. e3'teki at sıradan bir taş gibi yenebilir.",
      },
      {
        fen: '4r2k/8/8/8/3DK3/8/8/8 w - - 0 1',
        highlights: ['e4'],
        arrows: [['e8', 'e4']],
        caption: "Bölge şahı korumaz: e4'teki şah bölgede olsa da e8'deki kale şah çekiyor.",
      },
    ],
  },
  captureAllowed: (pos, from, victimSquare, _attacker, victim) => {
    // Rule 2: nothing standing in a zone captures (king included).
    if (inAura(pos, from)) return false;
    // Rule 1: nothing standing in a zone is captured, except the king.
    return !inAura(pos, victimSquare) || STANDARD_PIECES[victim.type]?.royal === true;
  },
  highlight: {
    label: 'Barış bölgesi',
    // The king's square is never shown as protected: the zone doesn't protect it.
    squares: (pos) => auraSquares(pos).filter((sq) => !STANDARD_PIECES[pos.board[sq]?.type ?? '']?.royal),
    ranks: AURA_RANKS,
  },
});
