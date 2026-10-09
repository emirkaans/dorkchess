import { ALL_DIRS, DIAGONAL, KNIGHT_JUMPS, ORTHOGONAL } from '../board.ts';
import type { MovePattern, PieceDefinition, PieceType, VariantDefinition } from '../types.ts';

// ---------------------------------------------------------------------------
// Reusable movement patterns

export const PAWN: MovePattern = { kind: 'pawn', doublePush: true, enPassant: true, promotion: true };
export const KNIGHT: MovePattern = { kind: 'step', dirs: KNIGHT_JUMPS };
export const BISHOP: MovePattern = { kind: 'slide', dirs: DIAGONAL };
export const ROOK: MovePattern = { kind: 'slide', dirs: ORTHOGONAL };
export const QUEEN: MovePattern = { kind: 'slide', dirs: ALL_DIRS };
export const KING_STEP: MovePattern = { kind: 'step', dirs: ALL_DIRS };

/** `patterns` for a piece that always moves the same way (returns one shared array, no allocation). */
export function fixedPatterns(...patterns: MovePattern[]): () => readonly MovePattern[] {
  return () => patterns;
}

// Text presentation selector keeps browsers from rendering ♟ as an emoji.
const glyph = (g: string) => ({ kind: 'glyph', glyph: g + '︎' }) as const;

// ---------------------------------------------------------------------------
// Standard pieces

export const STANDARD_PIECES: Readonly<Record<PieceType, PieceDefinition>> = {
  p: {
    type: 'p', name: 'Piyon', fenChar: 'p', sanLetter: '',
    patterns: fixedPatterns(PAWN),
    canCapture: true, capturable: true, material: 'major', icon: glyph('♟'),
  },
  n: {
    type: 'n', name: 'At', fenChar: 'n', sanLetter: 'N',
    patterns: fixedPatterns(KNIGHT),
    canCapture: true, capturable: true, material: 'minor', icon: glyph('♞'),
  },
  b: {
    type: 'b', name: 'Fil', fenChar: 'b', sanLetter: 'B',
    patterns: fixedPatterns(BISHOP),
    canCapture: true, capturable: true, material: 'minor', icon: glyph('♝'),
  },
  r: {
    type: 'r', name: 'Kale', fenChar: 'r', sanLetter: 'R',
    patterns: fixedPatterns(ROOK),
    canCapture: true, capturable: true, material: 'major', icon: glyph('♜'),
  },
  q: {
    type: 'q', name: 'Vezir', fenChar: 'q', sanLetter: 'Q',
    patterns: fixedPatterns(QUEEN),
    canCapture: true, capturable: true, material: 'major', icon: glyph('♛'),
  },
  k: {
    type: 'k', name: 'Şah', fenChar: 'k', sanLetter: 'K',
    patterns: fixedPatterns(KING_STEP),
    royal: true, castles: true,
    canCapture: true, capturable: true, material: 'none', icon: glyph('♚'),
  },
};

/** Material values (centipawns) of the standard pieces; variants extend this with their own pieces. */
export const STANDARD_VALUES: Readonly<Record<PieceType, number>> = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 };

export const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type VariantInput = Omit<VariantDefinition, 'isCapturable' | 'canCapture' | 'initialExtra' | 'pieceTypes'> &
  Partial<Pick<VariantDefinition, 'isCapturable' | 'canCapture' | 'initialExtra'>>;

/** Fill in defaults derived from piece definitions. */
export function defineVariant(input: VariantInput): VariantDefinition {
  return {
    isCapturable: (p) => input.pieces[p.type]?.capturable ?? false,
    canCapture: (p) => input.pieces[p.type]?.canCapture ?? false,
    initialExtra: () => ({}),
    ...input,
    pieceTypes: Object.keys(input.pieces),
  };
}

export const standard: VariantDefinition = defineVariant({
  id: 'standard',
  name: 'Standart',
  description: [
    'Klasik FIDE satrancı.',
    'Rok, en passant ve terfi (V/K/F/A) var.',
    'Mat, pat, 50 hamle, üç kez tekrar ve yetersiz materyal kuralları uygulanır.',
  ],
  startPosition: STANDARD_START,
  pieces: STANDARD_PIECES,
  promotionTypes: ['q', 'r', 'b', 'n'],
  pieceValues: STANDARD_VALUES,
  rules: {
    title: 'Standart satranç',
    summary: 'Klasik FIDE kuralları; amaç rakip şahı mat etmek.',
    bullets: [
      'Rok, en passant ve terfi (vezir, kale, fil, at) var.',
      'Yasal hamlesi olmayan taraf şah çekiliyse mat, değilse pat olur.',
      '50 hamle, üç kez tekrar ve yetersiz materyal beraberliktir.',
    ],
    examples: [],
  },
});
