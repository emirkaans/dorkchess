import type { Piece, Position, Square, VariantDefinition } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';
import { pieceSvg, usePieceSet } from './pieceSets.ts';
import type { PieceSet } from './pieceSets.ts';

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
  const { t, vt } = useI18n();
  const set = usePieceSet();
  const texts = vt(variant);
  const def = variant.pieces[piece.type];
  const name = texts.pieceName(piece.type);
  const badge = position ? texts.badge(piece.type, position, piece.color) : null;
  const inactive = position && square !== undefined && def.inactive ? def.inactive(position, square) : false;
  const colorClass = piece.color === 'w' ? 'white' : 'black';
  const title = badge ? `${name} — ${badge.title}` : inactive ? t('piece.inactive', { name }) : name;
  return (
    <span className={`piece ${colorClass}${inactive ? ' inactive' : ''}`} title={title}>
      {def.icon.kind === 'glyph' ? (
        <GlyphPiece set={set} glyph={def.icon.glyph} />
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

/** A standard piece: the font glyph, or its drawing in the chosen piece set. */
function GlyphPiece({ set, glyph }: { set: PieceSet; glyph: string }) {
  const svg = pieceSvg(set, glyph);
  if (!svg) return <span className="glyph">{glyph}</span>;
  return <span className={`set set-${set}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A knight drawn in a given piece set, for the settings previews. */
export function SetPiece({ set, color }: { set: PieceSet; color: 'w' | 'b' }) {
  return (
    <span className={`piece ${color === 'w' ? 'white' : 'black'}`}>
      <GlyphPiece set={set} glyph="♞" />
    </span>
  );
}
