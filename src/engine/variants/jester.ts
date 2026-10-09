import { FILES, opposite } from '../board.ts';
import type {
  Color,
  MovePattern,
  PieceDefinition,
  PieceType,
  Position,
  SetupQuestion,
  VariantExtra,
} from '../types.ts';
import type { FastBoard } from '../fast/board.ts';
import type { FastHooks, Side } from '../fast/hooks.ts';
import { BISHOP, KING_STEP, KNIGHT, QUEEN, ROOK, STANDARD_PIECES, STANDARD_VALUES, defineVariant } from './standard.ts';

/**
 * Jester moves and captures like the piece type the OPPONENT moved last
 * (its "form"). Extra state remembers the last moved piece type per color;
 * a moved Jester is recorded as the form it had, so forms chain from Jester to Jester.
 */
export interface JesterExtra {
  readonly lastMoved: { readonly w: PieceType | null; readonly b: PieceType | null };
}

/** Pawn form: single push and diagonal capture only; no double push, en passant or promotion. */
const JESTER_PAWN: MovePattern = { kind: 'pawn', doublePush: false, enPassant: false, promotion: false };

const FORM_PATTERNS: Readonly<Record<PieceType, readonly MovePattern[]>> = {
  p: [JESTER_PAWN],
  n: [KNIGHT],
  b: [BISHOP],
  r: [ROOK],
  q: [QUEEN],
  k: [KING_STEP], // king-like steps only: no castling, not royal
};

export const DEFAULT_FORM: PieceType = 'n';

const lastMoved = (pos: Position) => (pos.extra as unknown as JesterExtra).lastMoved;

/** Current form of `color`'s Jester: the opponent's last moved piece type. */
export function jesterForm(pos: Position, color: Color): PieceType {
  const t = lastMoved(pos)[opposite(color)];
  return t !== null && t in FORM_PATTERNS ? t : DEFAULT_FORM;
}

// Fast board: extra[side] = 1 + type index of the piece `side` moved last (0 = none yet).
const fastForm = (b: FastBoard, side: Side): PieceType => {
  const idx = b.extra[side === 0 ? 1 : 0] - 1;
  const t = idx >= 0 ? b.types[idx].letter : null;
  return t !== null && t in FORM_PATTERNS ? t : DEFAULT_FORM;
};

const FAST_HOOKS: FastHooks = {
  extraSlots: 2,
  readExtra: (b, pos) => {
    const lm = lastMoved(pos);
    b.extra[0] = lm.w ? b.typeIndex.get(lm.w)! + 1 : 0;
    b.extra[1] = lm.b ? b.typeIndex.get(lm.b)! + 1 : 0;
  },
  dynamicTypes: ['j'],
  patterns: (b, _type, side) => FORM_PATTERNS[fastForm(b, side)],
  afterMove: (b, movedType, side) => {
    const moved = movedType === 'j' ? fastForm(b, side) : movedType;
    b.extra[side] = b.typeIndex.get(moved)! + 1;
  },
  // Only forms of Jesters actually on the board matter (as in hashExtra).
  hashExtra: (b) => {
    const j = b.typeIndex.get('j')!;
    let h = 0;
    for (const side of [0, 1] as const) {
      if (b.count(j, side) > 0) h |= (b.typeIndex.get(fastForm(b, side))! + 1) << (side * 4);
    }
    return h;
  },
};

const fill = (c: Color) => (c === 'w' ? '#fafafa' : '#2b2b2b');
const ink = (c: Color) => (c === 'w' ? '#2b2b2b' : '#fafafa');

/** Jester's cap: three floppy two-tone points with bells, drooping outward. */
const jesterSvg = (c: Color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
  <path d="M12 33 C11 25 9 20 4 25 C4 15 10 11 17 16 Z" fill="#8e44ad" stroke="${ink(c)}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M33 33 C34 25 36 20 41 25 C41 15 35 11 28 16 Z" fill="#8e44ad" stroke="${ink(c)}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12 33 C13 22 16 14 22.5 6 C29 14 32 22 33 33 Z" fill="${fill(c)}" stroke="${ink(c)}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M10 33h25v5H10z" fill="${fill(c)}" stroke="${ink(c)}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M14 35.5h2M19 35.5h2M24 35.5h2M29 35.5h2" stroke="${ink(c)}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="4" cy="26.5" r="2.6" fill="#e1b12c" stroke="${ink(c)}" stroke-width="1.2"/>
  <circle cx="22.5" cy="5" r="2.6" fill="#e1b12c" stroke="${ink(c)}" stroke-width="1.2"/>
  <circle cx="41" cy="26.5" r="2.6" fill="#e1b12c" stroke="${ink(c)}" stroke-width="1.2"/>
</svg>`;

export const JESTER: PieceDefinition = {
  type: 'j',
  name: 'Jester',
  fenChar: 'j',
  sanLetter: 'J',
  patterns: (pos, color) => FORM_PATTERNS[jesterForm(pos, color)],
  canCapture: true,
  capturable: true,
  material: 'major',
  icon: { kind: 'svg', svg: jesterSvg },
  badge: (pos, color) => {
    const form = jesterForm(pos, color);
    const formDef = STANDARD_PIECES[form];
    const t = lastMoved(pos)[opposite(color)];
    const title =
      t === null ? `Rakip henüz hamle yapmadı: varsayılan form (${formDef.name})` : `Rakibin son taşı: ${formDef.name}`;
    return { label: formDef.icon.kind === 'glyph' ? formDef.icon.glyph : form.toUpperCase(), title };
  },
};

// ---------------------------------------------------------------------------
// Setup: each player picks which back-rank piece (queen, rook, bishop or knight;
// left or right) is replaced by their Jester. "Left"/"right" are from that player's seat.

const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/** Option id = file letter of the replaced piece's start square. */
const SLOT_FILES = ['d', 'a', 'h', 'c', 'f', 'b', 'g'];

function setupQuestion(color: Color): SetupQuestion {
  const rank = color === 'w' ? '1' : '8';
  return {
    id: color,
    color,
    title: `${color === 'w' ? 'Beyaz' : 'Siyah'}: hangi taşınız Jester olsun?`,
    defaultOption: 'g',
    options: SLOT_FILES.map((f) => {
      const file = FILES.indexOf(f);
      const type = BACK_RANK[file];
      const name = STANDARD_PIECES[type].name;
      const leftSide = color === 'w' ? file < 4 : file > 4;
      const label =
        type === 'q'
          ? `${name} (${f}${rank})`
          : `${leftSide ? 'Sol' : 'Sağ'} ${name.toLocaleLowerCase('tr')} (${f}${rank})`;
      return { id: f, label, icon: { type, color } };
    }),
  };
}

function jesterStartPosition(answers: Readonly<Record<string, string>>): string {
  const wFile = FILES.indexOf(answers.w);
  const bFile = FILES.indexOf(answers.b);
  const rank = (file: number, upper: boolean) =>
    BACK_RANK.map((t, i) => (i === file ? 'j' : t))
      .map((ch) => (upper ? ch.toUpperCase() : ch))
      .join('');
  // A side whose rook became the Jester loses castling on that wing.
  const castling =
    (wFile !== 7 ? 'K' : '') + (wFile !== 0 ? 'Q' : '') + (bFile !== 7 ? 'k' : '') + (bFile !== 0 ? 'q' : '');
  return `${rank(bFile, false)}/pppppppp/8/8/8/8/PPPPPPPP/${rank(wFile, true)} w ${castling || '-'} - 0 1 --`;
}

const initialExtra = (): VariantExtra => ({ lastMoved: { w: null, b: null } }) satisfies JesterExtra;

export const jester = defineVariant({
  id: 'jester',
  name: 'Jester',
  description: [
    'Oyun başında her oyuncu vezirini ya da sol/sağ kale, fil veya atını Jester (J) olarak seçer; o taşın yerine Jester konur.',
    'Kale seçilirse o kanatta rok yapılamaz.',
    'Jester, rakibin en son hareket ettirdiği taşın türü gibi hareket eder ve yer (formu).',
    "Rakip rok yaptıysa Şah formu (1 kare, rok yok); rakip Jester oynadıysa o Jester'in o anki formu; henüz hamle yoksa At formu.",
    'Piyon formu: tek kare ileri, çapraz yeme; çift adım, en passant ve terfi yok.',
    "Dikkat: oynadığınız taşın türü, rakip Jester'in bir sonraki formu olur. Şahınızı bu forma açık bırakan hamle yasal değildir.",
  ],
  startPosition: 'rnbqkbjr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBJR w KQkq - 0 1 --',
  setup: { questions: [setupQuestion('w'), setupQuestion('b')], startPosition: jesterStartPosition },
  pieces: { ...STANDARD_PIECES, j: JESTER },
  promotionTypes: ['q', 'r', 'b', 'n'],
  pieceValues: { ...STANDARD_VALUES, j: 300 },
  rules: {
    title: 'Jester',
    summary: 'Jester, rakibin en son oynattığı taşın türü gibi hareket eder ve yer.',
    bullets: [
      'Oyun başında her oyuncu hangi taşının (vezir, kale, fil, at) Jester olacağını seçer.',
      'Rakip son hamlede fil oynadıysa Jester fil gibi, piyon oynadıysa piyon gibi oynar.',
      'Piyon formunda çift adım, en passant ve terfi yok; rok sonrası şah formu.',
      'Henüz rakip hamlesi yoksa At formu.',
      "Oynadığın taşın türü rakip Jester'in formu olur: şahını o forma açık bırakan hamle yasal değil.",
    ],
    examples: [
      {
        fen: '4k3/8/8/7p/8/5J2/8/4K3 w - - 0 1 -b',
        highlights: ['f3'],
        arrows: [
          ['f3', 'c6'],
          ['f3', 'h5'],
          ['f3', 'h1'],
        ],
        caption: "Siyah son hamlede fil oynadı: beyaz Jester fil gibi gider ve h5'teki piyonu yiyebilir.",
      },
      {
        fen: '4k3/8/8/3p4/4J3/8/8/4K3 w - - 0 1 -p',
        highlights: ['e4'],
        arrows: [
          ['e4', 'e5'],
          ['e4', 'd5'],
        ],
        caption: 'Siyah piyon oynadı: Jester tek kare ileri gider ya da çapraz yer. Çift adım ve terfi yok.',
      },
      {
        fen: 'k3j3/8/8/8/r7/8/8/3QK3 w - - 0 1 --',
        highlights: ['e8', 'e1'],
        arrows: [['d1', 'a4']],
        caption:
          "Vezirle a4'teki kaleyi almak yasal değil: vezir oynanınca siyah Jester vezir olur ve e hattından şahı alır.",
      },
    ],
  },
  initialExtra,
  fast: FAST_HOOKS,
  afterMove: (pos, move) => {
    // A Jester counts as the piece it was imitating when it moved.
    const moved = move.piece === 'j' ? jesterForm(pos, pos.turn) : move.piece;
    return { lastMoved: { ...lastMoved(pos), [pos.turn]: moved } } satisfies JesterExtra;
  },
  // Only forms of Jesters actually on the board matter for repetition.
  hashExtra: (pos) =>
    (['w', 'b'] as const)
      .filter((c) => pos.board.some((p) => p?.type === 'j' && p.color === c))
      .map((c) => c + jesterForm(pos, c))
      .join(''),
  // FEN field 7: white's and black's last moved piece type, '-' if none (e.g. "-p", "qn").
  serializeExtra: (extra) => {
    const lm = (extra as unknown as JesterExtra).lastMoved;
    return (lm.w ?? '-') + (lm.b ?? '-');
  },
  parseExtra: (field) => {
    if (!field) return initialExtra();
    if (!/^[a-z-]{2}$/.test(field)) throw new Error(`Invalid Jester FEN field: ${field}`);
    const read = (ch: string) => (ch === '-' ? null : ch);
    return { lastMoved: { w: read(field[0]), b: read(field[1]) } } satisfies JesterExtra;
  },
});
