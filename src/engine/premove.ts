import { forward, makeSquare, offset, rankOf } from './board.ts';
import { pieceDef } from './movegen.ts';
import type { Position, Square, VariantDefinition } from './types.ts';

/**
 * Squares the piece on `from` might move to on its owner's next turn, for
 * premoves: the opponent moves first, so other pieces are ignored (sliders go
 * through them, pawns may push or capture diagonally). Whether the move is
 * really legal is decided when it is played.
 */
export function premoveTargets(v: VariantDefinition, pos: Position, from: Square): Square[] {
  const piece = pos.board[from];
  if (!piece) return [];
  const def = pieceDef(v, piece.type);
  // Patterns may depend on whose turn it is (e.g. Jester forms): ask for the owner's.
  const asOwner: Position = { ...pos, turn: piece.color };
  const out = new Set<Square>();
  for (const p of def.patterns(asOwner, piece.color)) {
    if (p.kind === 'pawn') {
      const fw = forward(piece.color);
      const one = offset(from, [0, fw]);
      if (one !== -1) {
        out.add(one);
        const startRank = piece.color === 'w' ? 1 : 6;
        if (p.doublePush && rankOf(from) === startRank) out.add(offset(one, [0, fw]));
      }
      for (const df of [-1, 1]) {
        const c = offset(from, [df, fw]);
        if (c !== -1) out.add(c);
      }
      continue;
    }
    for (const dir of p.dirs) {
      let to = offset(from, dir);
      while (to !== -1) {
        out.add(to);
        if (p.kind === 'step') break;
        to = offset(to, dir);
      }
    }
  }
  // Castling, while the rights last (the path is checked when it is played).
  if (def.castles) {
    const rank = piece.color === 'w' ? 0 : 7;
    const c = pos.castling;
    if (from === makeSquare(4, rank)) {
      if (piece.color === 'w' ? c.wK : c.bK) out.add(makeSquare(6, rank));
      if (piece.color === 'w' ? c.wQ : c.bQ) out.add(makeSquare(2, rank));
    }
  }
  out.delete(-1);
  out.delete(from);
  // A square held by one's own royal piece can't become free in one opponent move.
  return [...out].filter((s) => {
    const q = pos.board[s];
    return !(q && q.color === piece.color && pieceDef(v, q.type).royal);
  });
}

