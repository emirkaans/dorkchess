import type { Piece, Position, Square, VariantDefinition } from '../engine/index.ts';

interface Props {
  variant: VariantDefinition;
  piece: Piece;
  /** When given, the piece's badge (e.g. Jester form) is shown. */
  position?: Position;
  /** Square the piece stands on; with `position`, lets the piece show itself as inactive. */
  square?: Square;
}

/** Renders any piece purely from its definition — no variant-specific code. */
export function PieceView({ variant, piece, position, square }: Props) {
  const def = variant.pieces[piece.type];
  const badge = position && def.badge ? def.badge(position, piece.color) : null;
  const inactive = position && square !== undefined && def.inactive ? def.inactive(position, square) : false;
  const colorClass = piece.color === 'w' ? 'white' : 'black';
  const title = badge ? `${def.name} — ${badge.title}` : inactive ? `${def.name} (pasif)` : def.name;
  return (
    <span className={`piece ${colorClass}${inactive ? ' inactive' : ''}`} title={title}>
      {def.icon.kind === 'glyph' ? (
        <span className="glyph">{def.icon.glyph}</span>
      ) : (
        <span className="svg" dangerouslySetInnerHTML={{ __html: def.icon.svg(piece.color) }} />
      )}
      {badge && (
        <span className="badge" title={badge.title}>
          {badge.label}
        </span>
      )}
    </span>
  );
}
