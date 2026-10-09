import { useRef } from 'react';
import type { Color, PieceType, VariantDefinition } from '../engine/index.ts';
import { PieceView } from './PieceView.tsx';
import { useDialogFocus } from './useDialogFocus.ts';

interface Props {
  variant: VariantDefinition;
  color: Color;
  options: PieceType[];
  onPick: (type: PieceType) => void;
  onCancel: () => void;
}

export function PromotionDialog({ variant, color, options, onPick, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Terfi seçimi"
      >
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
