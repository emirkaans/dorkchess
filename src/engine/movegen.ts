import { fileOf, forward, makeSquare, offset, opposite, rankOf } from './board.ts';
import type {
  CastlingRights,
  Color,
  Move,
  MovePattern,
  Piece,
  PieceDefinition,
  Position,
  Square,
  VariantDefinition,
} from './types.ts';

export function pieceDef(v: VariantDefinition, type: string): PieceDefinition {
  const def = v.pieces[type];
  if (!def) throw new Error(`Variant ${v.id} has no piece type '${type}'`);
  return def;
}

/** Can `mover` on `from` capture `target` standing on `targetSq` under the variant's rules? */
export function canTake(
  v: VariantDefinition,
  pos: Position,
  from: Square,
  mover: Piece,
  targetSq: Square,
  target: Piece,
): boolean {
  return (
    target.color !== mover.color &&
    v.canCapture(mover) &&
    v.isCapturable(target) &&
    (!v.captureAllowed || v.captureAllowed(pos, from, targetSq, mover, target))
  );
}

// ---------------------------------------------------------------------------
// Pseudo-legal move generation

function pushPawnMoves(
  v: VariantDefinition,
  moves: Move[],
  from: Square,
  to: Square,
  piece: Piece,
  pattern: Extract<MovePattern, { kind: 'pawn' }>,
  captured: string | undefined,
): void {
  const lastRank = piece.color === 'w' ? 7 : 0;
  if (pattern.promotion && rankOf(to) === lastRank) {
    for (const promotion of v.promotionTypes) {
      moves.push(captured ? { from, to, piece: piece.type, captured, promotion } : { from, to, piece: piece.type, promotion });
    }
  } else {
    moves.push(captured ? { from, to, piece: piece.type, captured } : { from, to, piece: piece.type });
  }
}

function patternMoves(
  v: VariantDefinition,
  pos: Position,
  from: Square,
  piece: Piece,
  pattern: MovePattern,
  moves: Move[],
): void {
  const board = pos.board;
  switch (pattern.kind) {
    case 'slide':
      for (const dir of pattern.dirs) {
        let to = offset(from, dir);
        while (to !== -1) {
          const target = board[to];
          if (target) {
            if (canTake(v, pos, from, piece, to, target)) moves.push({ from, to, piece: piece.type, captured: target.type });
            break;
          }
          moves.push({ from, to, piece: piece.type });
          to = offset(to, dir);
        }
      }
      return;
    case 'step':
      for (const dir of pattern.dirs) {
        const to = offset(from, dir);
        if (to === -1) continue;
        const target = board[to];
        if (!target) moves.push({ from, to, piece: piece.type });
        else if (canTake(v, pos, from, piece, to, target)) moves.push({ from, to, piece: piece.type, captured: target.type });
      }
      return;
    case 'pawn': {
      const fw = forward(piece.color);
      const one = offset(from, [0, fw]);
      if (one !== -1 && !board[one]) {
        pushPawnMoves(v, moves, from, one, piece, pattern, undefined);
        const startRank = piece.color === 'w' ? 1 : 6;
        if (pattern.doublePush && rankOf(from) === startRank) {
          const two = offset(one, [0, fw]);
          if (two !== -1 && !board[two]) moves.push({ from, to: two, piece: piece.type, doublePush: true });
        }
      }
      for (const df of [-1, 1]) {
        const to = offset(from, [df, fw]);
        if (to === -1) continue;
        const target = board[to];
        if (target) {
          if (canTake(v, pos, from, piece, to, target)) pushPawnMoves(v, moves, from, to, piece, pattern, target.type);
        } else if (pattern.enPassant && pos.ep === to) {
          const victimSq = makeSquare(fileOf(to), rankOf(from));
          const victim = board[victimSq];
          if (victim && canTake(v, pos, from, piece, victimSq, victim)) {
            moves.push({ from, to, piece: piece.type, captured: victim.type, enPassant: true });
          }
        }
      }
      return;
    }
  }
}

function castlingMoves(v: VariantDefinition, pos: Position, from: Square, piece: Piece, moves: Move[]): void {
  const color = piece.color;
  const rank = color === 'w' ? 0 : 7;
  if (from !== makeSquare(4, rank)) return;
  const rights = pos.castling;
  const enemy = opposite(color);
  const sides: { side: 'K' | 'Q'; allowed: boolean; rookFile: number; between: number[]; transit: number }[] = [
    { side: 'K', allowed: color === 'w' ? rights.wK : rights.bK, rookFile: 7, between: [5, 6], transit: 5 },
    { side: 'Q', allowed: color === 'w' ? rights.wQ : rights.bQ, rookFile: 0, between: [1, 2, 3], transit: 3 },
  ];
  let inCheck: boolean | undefined;
  for (const s of sides) {
    if (!s.allowed) continue;
    const rook = pos.board[makeSquare(s.rookFile, rank)];
    if (!rook || rook.type !== 'r' || rook.color !== color) continue;
    if (s.between.some((f) => pos.board[makeSquare(f, rank)])) continue;
    inCheck ??= isSquareAttacked(v, pos, from, enemy);
    if (inCheck) return;
    // Destination safety is verified by the legality filter.
    if (isSquareAttacked(v, pos, makeSquare(s.transit, rank), enemy, piece)) continue;
    moves.push({ from, to: makeSquare(s.side === 'K' ? 6 : 2, rank), piece: piece.type, castle: s.side });
  }
}

/** Default pseudo-legal moves for the piece on `from` (ignores whose turn it is). */
export function baseMovesFrom(v: VariantDefinition, pos: Position, from: Square): Move[] {
  const piece = pos.board[from];
  if (!piece) return [];
  const def = pieceDef(v, piece.type);
  const moves: Move[] = [];
  for (const pattern of def.patterns(pos, piece.color)) patternMoves(v, pos, from, piece, pattern, moves);
  if (def.castles) castlingMoves(v, pos, from, piece, moves);
  return moves;
}

/** Pseudo-legal moves for the piece on `from`, honoring the variant override. */
export function pseudoMovesFrom(v: VariantDefinition, pos: Position, from: Square): Move[] {
  if (v.generateMoves) return v.generateMoves(pos, from, (p, f) => baseMovesFrom(v, p, f));
  return baseMovesFrom(v, pos, from);
}

/** All pseudo-legal moves for the side to move. */
export function pseudoMoves(v: VariantDefinition, pos: Position): Move[] {
  const moves: Move[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p && p.color === pos.turn) moves.push(...pseudoMovesFrom(v, pos, sq));
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Attacks

/** Does `pattern` from `from` attack `target` (i.e. could capture something standing there)? */
function patternAttacks(pos: Position, from: Square, color: Color, pattern: MovePattern, target: Square): boolean {
  const df = fileOf(target) - fileOf(from);
  const dr = rankOf(target) - rankOf(from);
  switch (pattern.kind) {
    case 'step':
      return pattern.dirs.some(([x, y]) => x === df && y === dr);
    case 'pawn':
      return dr === forward(color) && (df === 1 || df === -1);
    case 'slide': {
      if (df === 0 && dr === 0) return false;
      if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return false;
      const sx = Math.sign(df);
      const sy = Math.sign(dr);
      if (!pattern.dirs.some(([x, y]) => x === sx && y === sy)) return false;
      let sq = offset(from, [sx, sy]);
      while (sq !== target) {
        if (pos.board[sq]) return false;
        sq = offset(sq, [sx, sy]);
      }
      return true;
    }
  }
}

/**
 * Is `target` attacked by any piece of color `by`? Respects variant rules:
 * pieces that cannot capture (e.g. Bürokrat) attack nothing, and every piece
 * (including non-capturable ones) blocks sliding lines. `victim` is the piece
 * considered to stand on `target` (defaults to its occupant); it feeds the
 * variant's position-dependent capture rule, if any.
 */
export function isSquareAttacked(
  v: VariantDefinition,
  pos: Position,
  target: Square,
  by: Color,
  victim: Piece | null = pos.board[target] ?? null,
): boolean {
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p || p.color !== by || !v.canCapture(p)) continue;
    if (v.captureAllowed && victim && !v.captureAllowed(pos, sq, target, p, victim)) continue;
    for (const pattern of pieceDef(v, p.type).patterns(pos, by)) {
      if (patternAttacks(pos, sq, by, pattern, target)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Applying a move to a position (no legality checks)

const CORNER_RIGHTS: Readonly<Record<number, keyof CastlingRights>> = {
  0: 'wQ',
  7: 'wK',
  56: 'bQ',
  63: 'bK',
};

export function applyMove(v: VariantDefinition, pos: Position, move: Move): Position {
  const board = pos.board.slice();
  const mover = board[move.from];
  if (!mover) throw new Error('applyMove: no piece on from-square');
  const color = mover.color;

  board[move.from] = null;
  if (move.enPassant) board[makeSquare(fileOf(move.to), rankOf(move.from))] = null;
  board[move.to] = move.promotion ? { type: move.promotion, color } : mover;
  if (move.castle) {
    const rank = rankOf(move.from);
    const [rookFrom, rookTo] = move.castle === 'K' ? [7, 5] : [0, 3];
    board[makeSquare(rookTo, rank)] = board[makeSquare(rookFrom, rank)];
    board[makeSquare(rookFrom, rank)] = null;
  }

  const castling = { ...pos.castling };
  if (pieceDef(v, mover.type).castles) {
    if (color === 'w') castling.wK = castling.wQ = false;
    else castling.bK = castling.bQ = false;
  }
  const fromRight = CORNER_RIGHTS[move.from];
  if (fromRight) castling[fromRight] = false;
  const toRight = CORNER_RIGHTS[move.to];
  if (toRight) castling[toRight] = false;

  const resetsClock = mover.type === 'p' || move.captured !== undefined;

  return {
    board,
    turn: opposite(color),
    castling,
    ep: move.doublePush ? makeSquare(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2) : null,
    halfmove: resetsClock ? 0 : pos.halfmove + 1,
    fullmove: color === 'b' ? pos.fullmove + 1 : pos.fullmove,
    extra: v.afterMove ? v.afterMove(pos, move) : pos.extra,
  };
}
