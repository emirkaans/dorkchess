import { ALL_DIRS } from '../board.ts';
import type { MovePattern, PieceDefinition } from '../types.ts';
import { SLAB_BASE, glyphStyleSvg } from './icons.ts';
import { STANDARD_PIECES, defineVariant } from './standard.ts';

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
  patterns: () => [BUROKRAT_STEP],
  canCapture: false,
  capturable: false,
  material: 'none',
  icon: { kind: 'svg', svg: burokratSvg },
};

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
});
