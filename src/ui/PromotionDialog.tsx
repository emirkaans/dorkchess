import type { Color, PieceType, VariantDefinition } from '../engine/index.ts';
import { PieceView } from './PieceView.tsx';

interface Props {
  variant: VariantDefinition;
  color: Color;
  options: PieceType[];
  onPick: (type: PieceType) => void;
  onCancel: () => void;
}

export function PromotionDialog({ variant, color, options, onPick, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Terfi seçimi">
        <p>Terfi:</p>
        <div className="promo-options">
          {options.map((t) => (
            <button key={t} className="promo" onClick={() => onPick(t)} title={variant.pieces[t].name}>
              <PieceView variant={variant} piece={{ type: t, color }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
