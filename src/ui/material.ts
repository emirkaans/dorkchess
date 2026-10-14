// The material difference shown beside each player, as on lichess: only the
// pieces one side has more of (not every captured piece), and the lead in
// points. It never grows past a few pieces, so the player rows keep their size.

import type { Color, PieceType, Position, VariantDefinition } from '../engine/index.ts';

export interface MaterialDiff {
  /** Per side: the pieces it has more of than the other side, most valuable first. */
  readonly extra: Readonly<Record<Color, readonly PieceType[]>>;
  /** Per side: how many points it is ahead (0 when it is not). */
  readonly lead: Readonly<Record<Color, number>>;
}

export function materialDiff(v: VariantDefinition, p: Position): MaterialDiff {
  const count: Record<Color, Map<PieceType, number>> = { w: new Map(), b: new Map() };
  const points: Record<Color, number> = { w: 0, b: 0 };
  for (const piece of p.board) {
    if (!piece) continue;
    count[piece.color].set(piece.type, (count[piece.color].get(piece.type) ?? 0) + 1);
    points[piece.color] += v.pieceValues[piece.type];
  }
  const extra: Record<Color, PieceType[]> = { w: [], b: [] };
  for (const type of new Set([...count.w.keys(), ...count.b.keys()])) {
    const d = (count.w.get(type) ?? 0) - (count.b.get(type) ?? 0);
    for (let i = 0; i < Math.abs(d); i++) extra[d > 0 ? 'w' : 'b'].push(type);
  }
  const byValue = (a: PieceType, b: PieceType) => v.pieceValues[b] - v.pieceValues[a];
  extra.w.sort(byValue);
  extra.b.sort(byValue);
  const diff = Math.round((points.w - points.b) / 100);
  return { extra, lead: { w: Math.max(0, diff), b: Math.max(0, -diff) } };
}
