import { squareName } from './board.ts';
import { applyMove, pieceDef } from './movegen.ts';
import { isInCheck, legalMoves } from './legality.ts';
import { moveToSan, parseFen, toFen } from './notation.ts';
import type { GameResult, GameState, Move, PieceType, Position, Square, VariantDefinition } from './types.ts';

/**
 * Hash for repetition detection: placement, turn, castling rights, en passant
 * square (only when an en passant capture is actually legal) and the variant's
 * extra state (e.g. Jester forms).
 */
export function positionKey(v: VariantDefinition, pos: Position, legal: Move[] = legalMoves(v, pos)): string {
  const [placement, turn, castling] = toFen(v, pos).split(' ');
  const ep = legal.some((m) => m.enPassant) && pos.ep !== null ? squareName(pos.ep) : '-';
  return [placement, turn, castling, ep, v.hashExtra?.(pos) ?? ''].join(' ');
}

/**
 * Only K-K, K+minor-K count as insufficient. Pieces with material 'none'
 * (kings, Bürokrat) are ignored.
 */
export function isInsufficientMaterial(v: VariantDefinition, pos: Position): boolean {
  const relevant = pos.board.filter((p) => p !== null && pieceDef(v, p.type).material !== 'none');
  if (relevant.length === 0) return true;
  return relevant.length === 1 && pieceDef(v, relevant[0]!.type).material === 'minor';
}

function defaultResult(v: VariantDefinition, pos: Position, history: readonly string[], legal: Move[]): GameResult | null {
  if (legal.length === 0) {
    return isInCheck(v, pos)
      ? { reason: 'checkmate', winner: pos.turn === 'w' ? 'b' : 'w' }
      : { reason: 'stalemate', winner: null };
  }
  if (pos.halfmove >= 100) return { reason: 'fifty-move', winner: null };
  const key = history[history.length - 1];
  if (history.filter((k) => k === key).length >= 3) return { reason: 'threefold', winner: null };
  if (isInsufficientMaterial(v, pos)) return { reason: 'insufficient', winner: null };
  return null;
}

function buildState(
  v: VariantDefinition,
  position: Position,
  prevHistory: readonly string[],
  moves: GameState['moves'],
  previous: GameState | null,
): GameState {
  const legal = legalMoves(v, position);
  const history = [...prevHistory, positionKey(v, position, legal)];
  const partial: GameState = { variantId: v.id, position, history, moves, previous, result: null };
  const base = defaultResult(v, position, history, legal);
  const result = v.isGameOver ? v.isGameOver(partial, base) : base;
  return { ...partial, result };
}

/** Start position for the given setup answers; missing answers use each question's default. */
export function setupStartPosition(v: VariantDefinition, answers: Readonly<Record<string, string>> = {}): string {
  if (!v.setup) return v.startPosition;
  const full: Record<string, string> = {};
  for (const q of v.setup.questions) {
    const a = answers[q.id] ?? q.defaultOption;
    if (!q.options.some((o) => o.id === a)) throw new Error(`Invalid answer '${a}' for setup question '${q.id}'`);
    full[q.id] = a;
  }
  return v.setup.startPosition(full);
}

export function createGame(v: VariantDefinition, fen: string = v.startPosition): GameState {
  return buildState(v, parseFen(v, fen), [], [], null);
}

const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && a.promotion === b.promotion && a.castle === b.castle;

/** Play a legal move. Throws if the move is illegal or the game is over. */
export function makeMove(v: VariantDefinition, state: GameState, move: Move): GameState {
  if (state.result) throw new Error('Game is over');
  const legal = legalMoves(v, state.position);
  const real = legal.find((m) => sameMove(m, move));
  if (!real) throw new Error('Illegal move');
  const san = moveToSan(v, state.position, real, legal);
  const position = applyMove(v, state.position, real);
  return buildState(v, position, state.history, [...state.moves, { move: real, san }], state);
}

export function undoMove(state: GameState): GameState {
  return state.previous ?? state;
}

/** Find a legal move by squares (and promotion piece if needed). */
export function findMove(
  v: VariantDefinition,
  state: GameState,
  from: Square,
  to: Square,
  promotion?: PieceType,
): Move | undefined {
  return legalMoves(v, state.position).find(
    (m) => m.from === from && m.to === to && (m.promotion === undefined || m.promotion === promotion),
  );
}

/** Convenience for tests/scripts: play moves given in SAN. */
export function playSan(v: VariantDefinition, state: GameState, ...sans: string[]): GameState {
  for (const san of sans) {
    const legal = legalMoves(v, state.position);
    const strip = (s: string) => s.replace(/[+#]$/, '');
    const move = legal.find((m) => strip(moveToSan(v, state.position, m, legal)) === strip(san));
    if (!move) throw new Error(`Illegal/unknown SAN '${san}' in ${toFen(v, state.position)}`);
    state = makeMove(v, state, move);
  }
  return state;
}
