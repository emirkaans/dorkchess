import { useRef } from 'react';
import type { Color, PieceType, VariantDefinition } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';
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
  const { t, vt } = useI18n();
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
        aria-label={t('promotion.label')}
      >
        <p>{t('promotion.title')}</p>
        <div className="promo-options">
          {options.map((type) => (
            <button key={type} className="promo" onClick={() => onPick(type)} title={vt(variant).pieceName(type)}>
              <PieceView variant={variant} piece={{ type, color }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
