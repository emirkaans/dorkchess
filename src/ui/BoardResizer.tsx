import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useI18n } from './i18n.tsx';

export const MIN_BOARD = 240;
const MAX_BOARD = 1600;
const KEY_STEP = 16;

/** Largest board that still fits beside the players column (above it on phones) and the gutters. */
const maxBoard = () =>
  Math.max(MIN_BOARD, Math.min(MAX_BOARD, window.innerWidth - (window.innerWidth > 760 ? 360 : 50)));
export const clampBoard = (px: number) => Math.round(Math.min(maxBoard(), Math.max(MIN_BOARD, px)));

interface Props {
  /** Current board width in px (as drawn). */
  current: () => number;
  /** New size in px, or null for the automatic size. */
  onResize: (size: number | null) => void;
}

/** Corner handle on the board frame: drag to resize the board, double click to go back to auto. */
export function BoardResizer({ current, onResize }: Props) {
  const { t } = useI18n();
  const start = useRef<{ x: number; y: number; size: number } | null>(null);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, size: current() };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    // Diagonal drag: follow whichever direction moved more.
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    onResize(clampBoard(s.size + (Math.abs(dx) > Math.abs(dy) ? dx : dy)));
  };
  const up = () => {
    start.current = null;
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowUp: KEY_STEP, ArrowRight: KEY_STEP, ArrowDown: -KEY_STEP, ArrowLeft: -KEY_STEP }[e.key];
    if (step) {
      e.preventDefault();
      onResize(clampBoard(current() + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onResize(null);
    }
  };

  return (
    <button
      type="button"
      className="board-resize"
      aria-label={t('board.resize')}
      title={t('board.resize')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onResize(null)}
      onKeyDown={key}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M14 6L6 14M14 10l-4 4M14 2L2 14" />
      </svg>
    </button>
  );
}
