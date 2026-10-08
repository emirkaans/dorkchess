import type { Color, Dir, Piece, Square } from './types.ts';

export const FILES = 'abcdefgh';

export const fileOf = (sq: Square): number => sq & 7;
export const rankOf = (sq: Square): number => sq >> 3;
export const makeSquare = (file: number, rank: number): Square => rank * 8 + file;

export const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8;

/** Square reached from `sq` by `dir`, or -1 if off board. */
export function offset(sq: Square, dir: Dir): Square {
  const f = fileOf(sq) + dir[0];
  const r = rankOf(sq) + dir[1];
  return onBoard(f, r) ? makeSquare(f, r) : -1;
}

export function squareName(sq: Square): string {
  return FILES[fileOf(sq)] + String(rankOf(sq) + 1);
}

export function parseSquare(name: string): Square {
  if (!/^[a-h][1-8]$/.test(name)) throw new Error(`Invalid square: ${name}`);
  return makeSquare(FILES.indexOf(name[0]), Number(name[1]) - 1);
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Forward rank direction for pawns of the given color. */
export const forward = (c: Color): number => (c === 'w' ? 1 : -1);

export const emptyBoard = (): (Piece | null)[] => new Array<Piece | null>(64).fill(null);

export const ORTHOGONAL: readonly Dir[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const DIAGONAL: readonly Dir[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
export const ALL_DIRS: readonly Dir[] = [...ORTHOGONAL, ...DIAGONAL];
export const KNIGHT_JUMPS: readonly Dir[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
