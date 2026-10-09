import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus.ts';

interface Props {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** Full-screen dialog: click outside or Escape closes it; focus moves in and back (see useDialogFocus). */
export function Modal({ label, onClose, className = '', children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="modal-backdrop screen" onClick={onClose}>
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
