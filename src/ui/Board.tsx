import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  FILES,
  fileOf,
  isInCheck,
  legalMovesFrom,
  makeSquare,
  rankOf,
  royalSquares,
} from '../engine/index.ts';
import type { Move, Position, Square, VariantDefinition } from '../engine/index.ts';
import { PieceView } from './PieceView.tsx';

interface Props {
  variant: VariantDefinition;
  position: Position;
  lastMove: Move | null;
  flipped: boolean;
  /** Squares to tint (variant zones of effect). */
  highlight: readonly Square[];
  /** Board rows (0-based ranks) to outline faintly as one band. */
  bandRanks: readonly number[];
  disabled: boolean;
  /** Called with all legal moves matching from/to (several when promoting). */
  onMove: (candidates: Move[]) => void;
}

interface Drag {
  from: Square;
  x: number;
  y: number;
  moved: boolean;
}

export function Board({ variant, position, lastMove, flipped, highlight, bandRanks, disabled, onMove }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Mirrors `drag` synchronously: pointer events can fire faster than React re-renders.
  const dragRef = useRef<Drag | null>(null);
  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Reset selection whenever the position changes.
  const [seenPosition, setSeenPosition] = useState(position);
  if (seenPosition !== position) {
    setSeenPosition(position);
    setSelected(null);
    updateDrag(null);
  }

  const targets = useMemo(
    () => (selected === null || disabled ? [] : legalMovesFrom(variant, position, selected)),
    [variant, position, selected, disabled],
  );

  const checkSquares = useMemo(
    () => (isInCheck(variant, position) ? royalSquares(variant, position, position.turn) : []),
    [variant, position],
  );

  const squareAt = (clientX: number, clientY: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return flipped ? makeSquare(7 - col, row) : makeSquare(col, 7 - row);
  };

  const tryMove = (from: Square, to: Square): boolean => {
    // Computed directly (not from `targets`) so a fast drag doesn't depend on a re-render.
    const candidates = legalMovesFrom(variant, position, from).filter((m) => m.to === to);
    if (!candidates.length) return false;
    onMove(candidates);
    return true;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === null) return;
    if (selected !== null && tryMove(selected, sq)) return;
    const piece = position.board[sq];
    if (piece && piece.color === position.turn) {
      setSelected(sq);
      updateDrag({ from: sq, x: e.clientX, y: e.clientY, moved: false });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    updateDrag({ ...d, x: e.clientX, y: e.clientY, moved });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const sq = squareAt(e.clientX, e.clientY);
    updateDrag(null);
    // Released over another square = drop; released on the start square = plain click (keeps selection).
    if (sq !== null && sq !== d.from) tryMove(d.from, sq);
  };

  // Faint line along the band's outer edges; which edge is "top" depends on orientation.
  const bandEdge = (sq: Square) => {
    const r = rankOf(sq);
    if (!bandRanks.includes(r)) return '';
    const above = bandRanks.includes(r + 1);
    const below = bandRanks.includes(r - 1);
    const [top, bottom] = flipped ? [!below, !above] : [!above, !below];
    return [top ? 'band-top' : '', bottom ? 'band-bottom' : ''].join(' ');
  };

  const rect = boardRef.current?.getBoundingClientRect();
  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = flipped ? makeSquare(7 - col, row) : makeSquare(col, 7 - row);
      const piece = position.board[sq];
      const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
      const target = targets.find((m) => m.to === sq);
      const classes = [
        'square',
        light ? 'light' : 'dark',
        lastMove && (lastMove.from === sq || lastMove.to === sq) ? 'last' : '',
        selected === sq ? 'selected' : '',
        checkSquares.includes(sq) ? 'check' : '',
        highlight.includes(sq) ? 'zone' : '',
        bandEdge(sq),
      ].join(' ');
      const dragging = drag?.moved && drag.from === sq;
      squares.push(
        <div key={sq} className={classes} data-square={sq}>
          {piece && !dragging && <PieceView variant={variant} piece={piece} position={position} square={sq} />}
          {target && <span className={target.captured ? 'hint capture' : 'hint'} />}
          {col === 0 && <span className="coord rank">{rankOf(sq) + 1}</span>}
          {row === 7 && <span className="coord file">{FILES[fileOf(sq)]}</span>}
        </div>,
      );
    }
  }

  const dragPiece = drag?.moved ? position.board[drag.from] : null;

  return (
    <div
      ref={boardRef}
      className={`board${disabled ? ' disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => updateDrag(null)}
    >
      {squares}
      {dragPiece && drag && rect && (
        <div
          className="drag-ghost"
          style={{
            width: rect.width / 8,
            height: rect.height / 8,
            left: drag.x - rect.left - rect.width / 16,
            top: drag.y - rect.top - rect.height / 16,
          }}
        >
          <PieceView variant={variant} piece={dragPiece} position={position} />
        </div>
      )}
    </div>
  );
}
