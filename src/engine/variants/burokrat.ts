import { ALL_DIRS, offset } from '../board.ts';
import type { Color, MovePattern, PieceDefinition, Position } from '../types.ts';
import { SLAB_BASE, glyphStyleSvg } from './icons.ts';
import { STANDARD_PIECES, STANDARD_PIECE_NAMES_EN, STANDARD_VALUES, defineVariant, fixedPatterns } from './standard.ts';

/** One step in any direction; capture-free because the piece has canCapture: false. */
const BUROKRAT_STEP: MovePattern = { kind: 'step', dirs: ALL_DIRS };

/** Inkwell with a quill, drawn in the glyph style (see icons.ts). */
const burokratSvg = glyphStyleSvg([
  SLAB_BASE,
  'M690 1512 H1358 A90 90 0 0 0 1448 1422 V1162 A90 90 0 0 0 1358 1072 H690 A90 90 0 0 0 600 1162 V1422 A90 90 0 0 0 690 1512 Z M660 1352 L1388 1352 L1388 1312 L660 1312 Z',
  'M870 1032 H1178 A20 20 0 0 0 1198 1012 V962 A20 20 0 0 0 1178 942 H870 A20 20 0 0 0 850 962 V1012 A20 20 0 0 0 870 1032 Z',
  'M960 902 C980 612 1230 372 1580 262 C1520 522 1320 782 1070 902 Z M1030 872 L1060 882 L1520 312 L1490 302 Z M1150 572 L1180 582 L1270 662 L1245 677 Z M1290 452 L1320 462 L1400 532 L1375 547 Z',
]);

export const BUROKRAT: PieceDefinition = {
  type: 'u',
  name: 'Bürokrat',
  fenChar: 'u',
  sanLetter: 'U',
  patterns: fixedPatterns(BUROKRAT_STEP),
  canCapture: false,
  capturable: false,
  material: 'none',
  icon: { kind: 'svg', svg: burokratSvg },
};

/** Shield bonus: +15 for each own Bürokrat standing next to the own king. */
function shieldBonus(pos: Position, color: Color): number {
  let bonus = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p?.type !== 'k' || p.color !== color) continue;
    for (const dir of ALL_DIRS) {
      const n = offset(sq, dir);
      const q = n === -1 ? null : pos.board[n];
      if (q?.type === 'u' && q.color === color) bonus += 15;
    }
  }
  return bonus;
}

export const burokrat = defineVariant({
  id: 'burokrat',
  name: 'Bürokrat',
  description: [
    "g1/g8'deki atların yerine Bürokrat (U) başlar.",
    'Bürokrat her yöne 1 kare, yalnızca boş kareye gider.',
    'Hiçbir taşı yiyemez, hiçbir taş onu yiyemez; şah çekmez, hiçbir kareyi tehdit etmez.',
    'Kayan taşların yolunu keser; araya girerek şahı kurtarabilir.',
    "Piyon Bürokrat'a terfi edemez.",
  ],
  startPosition: 'rnbqkbur/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBUR w KQkq - 0 1',
  pieces: { ...STANDARD_PIECES, u: BUROKRAT },
  promotionTypes: ['q', 'r', 'b', 'n'],
  pieceValues: { ...STANDARD_VALUES, u: 100 },
  evaluateExtra: shieldBonus,
  fast: {
    evaluate: (b, side) => {
      const k = b.typeIndex.get('k')!;
      const u = b.typeIndex.get('u')!;
      if (b.count(k, side) !== 1) return 0;
      const king = b.squares(k, side)[0];
      const list = b.squares(u, side);
      let bonus = 0;
      for (let i = b.count(u, side) - 1; i >= 0; i--) {
        const s = list[i];
        if (Math.abs((s & 7) - (king & 7)) <= 1 && Math.abs((s >> 3) - (king >> 3)) <= 1) bonus += 15;
      }
      return bonus;
    },
  },
  rules: {
    title: 'Bürokrat',
    summary: "g1/g8'deki atların yerine Bürokrat başlar: kimseyi yemez, kimse onu yiyemez, ama yol keser.",
    bullets: [
      'Her yöne 1 kare, yalnızca boş kareye gider.',
      'Hiçbir taşı yiyemez; hiçbir taş (şah dahil) onu yiyemez.',
      'Şah çekmez, hiçbir kareyi tehdit etmez.',
      'Kale, fil ve vezirin yolunu keser; araya girip şahı kurtarabilir.',
      "Piyon Bürokrat'a terfi edemez.",
    ],
    examples: [
      {
        fen: '4k3/8/8/3p4/3U4/3P4/8/4K3 w - - 0 1',
        highlights: ['c3', 'c4', 'c5', 'e3', 'e4', 'e5'],
        arrows: [
          ['d4', 'c5'],
          ['d4', 'e5'],
          ['d4', 'e3'],
        ],
        caption: "Bürokrat her yöne 1 kare, yalnızca boş kareye gider. d5'teki piyonu yiyemez.",
      },
      {
        fen: '4q2k/8/8/8/4U3/8/8/4K3 b - - 0 1',
        highlights: ['e4'],
        arrows: [['e8', 'e5']],
        caption: "Siyah vezir Bürokrat'ı yiyemez ve arkasına geçemez: e1'deki şaha ulaşamaz.",
      },
      {
        fen: 'k3r3/8/8/8/8/8/3U4/4K3 w - - 0 1',
        highlights: ['e1'],
        arrows: [['d2', 'e2']],
        caption: "Kale e1'e şah çekiyor. Bürokrat e2'ye girip yolu keser, şahı kurtarır.",
      },
    ],
  },
  translations: {
    en: {
      name: 'Bureaucrat',
      description: [
        'A Bureaucrat (U) starts in place of the knights on g1/g8.',
        'The Bureaucrat moves 1 square in any direction, only to an empty square.',
        'It captures nothing and nothing can capture it; it gives no check and attacks no square.',
        'It blocks sliding pieces; it can save the king by stepping in between.',
        'A pawn cannot promote to a Bureaucrat.',
      ],
      rules: {
        title: 'Bureaucrat',
        summary:
          'A Bureaucrat starts in place of the knights on g1/g8: it captures no one and no one can capture it, but it blocks the way.',
        bullets: [
          'Moves 1 square in any direction, only to an empty square.',
          'Cannot capture anything; nothing (not even a king) can capture it.',
          'Gives no check and attacks no square.',
          'Blocks rooks, bishops and queens; it can step in between to save the king.',
          'A pawn cannot promote to a Bureaucrat.',
        ],
        captions: [
          'The Bureaucrat moves 1 square in any direction, only to an empty square. It cannot take the pawn on d5.',
          'The black queen cannot take the Bureaucrat or pass behind it: it cannot reach the king on e1.',
          'The rook checks the king on e1. The Bureaucrat steps to e2, blocks the line and saves the king.',
        ],
      },
      pieceNames: { ...STANDARD_PIECE_NAMES_EN, u: 'Bureaucrat' },
    },
  },
});
