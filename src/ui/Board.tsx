import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  FILES,
  fileOf,
  isInCheck,
  legalMovesFrom,
  makeSquare,
  premoveTargets,
  rankOf,
  royalSquares,
} from '../engine/index.ts';
import type { Color, Move, Position, Square, VariantDefinition } from '../engine/index.ts';
import { PieceView } from './PieceView.tsx';

/** Colours of drawn shapes, as on lichess: plain right-drag green; Shift red, Alt blue, Ctrl yellow. */
export type ShapeColor = 'green' | 'red' | 'blue' | 'yellow' | 'hint';

export interface Arrow {
  readonly from: Square;
  readonly to: Square;
  readonly color: ShapeColor;
}

interface Circle {
  readonly sq: Square;
  readonly color: ShapeColor;
}

export interface Premove {
  readonly from: Square;
  readonly to: Square;
}

interface Props {
  variant: VariantDefinition;
  position: Position;
  lastMove: Move | null;
  flipped: boolean;
  /** Squares to tint (variant zones of effect). */
  highlight: readonly Square[];
  /** Board rows (0-based ranks) to outline faintly as one band. */
  bandRanks: readonly number[];
  /** Arrows drawn by the app (e.g. a hint), as [from, to]. */
  arrows?: readonly (readonly [Square, Square])[];
  disabled: boolean;
  /** Called with all legal moves matching from/to (several when promoting). */
  onMove: (candidates: Move[]) => void;
  /**
   * While the board is disabled because the opponent is to move, this colour
   * may queue one move (premove), played as soon as it is legal.
   */
  premoveColor?: Color | null;
  premove?: Premove | null;
  onPremove?: (p: Premove) => void;
  onCancelPremove?: () => void;
}

interface Drag {
  from: Square;
  x: number;
  y: number;
  moved: boolean;
}

/** Right-button drag in progress: from where, to where now, in which colour. */
interface Drawing {
  from: Square;
  to: Square;
  color: ShapeColor;
}

const colorFor = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): ShapeColor =>
  e.ctrlKey || e.metaKey ? 'yellow' : e.shiftKey ? 'red' : e.altKey ? 'blue' : 'green';

export function Board({
  variant,
  position,
  lastMove,
  flipped,
  highlight,
  bandRanks,
  arrows = [],
  disabled,
  onMove,
  premoveColor = null,
  premove = null,
  onPremove,
  onCancelPremove,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Mirrors `drag` synchronously: pointer events can fire faster than React re-renders.
  const dragRef = useRef<Drag | null>(null);
  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const [shapes, setShapes] = useState<{ arrows: Arrow[]; circles: Circle[] }>({ arrows: [], circles: [] });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const updateDrawing = (d: Drawing | null) => {
    drawingRef.current = d;
    setDrawing(d);
  };

  const premoving = disabled && premoveColor !== null;

  // When the position changes, keep a selected piece only if it is still there and still
  // ours (e.g. picked while the opponent was thinking); otherwise reset the selection.
  const [seenPosition, setSeenPosition] = useState(position);
  if (seenPosition !== position) {
    setSeenPosition(position);
    const owner = selected !== null ? seenPosition.board[selected] : null;
    const now = selected !== null ? position.board[selected] : null;
    const keep = owner && now && owner.color === now.color && owner.type === now.type && !dragRef.current?.moved;
    if (!keep) {
      setSelected(null);
      updateDrag(null);
    }
  }

  const targets = useMemo(
    () => (selected === null || disabled ? [] : legalMovesFrom(variant, position, selected)),
    [variant, position, selected, disabled],
  );
  const premoveDests = useMemo(
    () => (selected === null || !premoving ? [] : premoveTargets(variant, position, selected)),
    [variant, position, selected, premoving],
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
    if (premoving) {
      // Computed directly (not from the memo) so a fast drag doesn't depend on a re-render.
      if (!premoveTargets(variant, position, from).includes(to)) return false;
      onPremove?.({ from, to });
      setSelected(null);
      return true;
    }
    const candidates = legalMovesFrom(variant, position, from).filter((m) => m.to === to);
    if (!candidates.length) return false;
    onMove(candidates);
    return true;
  };

  /** Toggles a drawn arrow or circle (same shape again removes it; another colour replaces it). */
  const toggleShape = (d: Drawing) => {
    setShapes(({ arrows: as, circles: cs }) => {
      if (d.from === d.to) {
        const old = cs.find((c) => c.sq === d.from);
        const rest = cs.filter((c) => c.sq !== d.from);
        return { arrows: as, circles: old?.color === d.color ? rest : [...rest, { sq: d.from, color: d.color }] };
      }
      const old = as.find((a) => a.from === d.from && a.to === d.to);
      const rest = as.filter((a) => !(a.from === d.from && a.to === d.to));
      return {
        circles: cs,
        arrows: old?.color === d.color ? rest : [...rest, { from: d.from, to: d.to, color: d.color }],
      };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sq = squareAt(e.clientX, e.clientY);
    if (e.button === 2) {
      // Right button: cancels a queued premove, otherwise starts drawing.
      if (premove) {
        onCancelPremove?.();
        return;
      }
      if (sq === null) return;
      updateDrawing({ from: sq, to: sq, color: colorFor(e) });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // A left click clears the drawings, as on lichess and chess.com.
    if (shapes.arrows.length || shapes.circles.length) setShapes({ arrows: [], circles: [] });
    if (sq === null || (disabled && !premoving)) return;
    if (selected !== null && tryMove(selected, sq)) return;
    const piece = position.board[sq];
    const own = premoving ? premoveColor : position.turn;
    if (piece && piece.color === own) {
      setSelected(sq);
      updateDrag({ from: sq, x: e.clientX, y: e.clientY, moved: false });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setSelected(null);
      if (premoving && premove) onCancelPremove?.();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const dr = drawingRef.current;
    if (dr) {
      const sq = squareAt(e.clientX, e.clientY);
      if (sq !== null && sq !== dr.to) updateDrawing({ ...dr, to: sq });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    updateDrag({ ...d, x: e.clientX, y: e.clientY, moved });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const dr = drawingRef.current;
    if (dr && e.button === 2) {
      updateDrawing(null);
      toggleShape(dr);
      return;
    }
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
      const premoveDest = premoveDests.includes(sq);
      const classes = [
        'square',
        light ? 'light' : 'dark',
        lastMove && (lastMove.from === sq || lastMove.to === sq) ? 'last' : '',
        selected === sq ? 'selected' : '',
        premove && (premove.from === sq || premove.to === sq) ? 'premove' : '',
        checkSquares.includes(sq) ? 'check' : '',
        highlight.includes(sq) ? 'zone' : '',
        bandEdge(sq),
      ].join(' ');
      const dragging = drag?.moved && drag.from === sq;
      squares.push(
        <div key={sq} className={classes} data-square={sq}>
          {piece && !dragging && <PieceView variant={variant} piece={piece} position={position} square={sq} />}
          {target && <span className={target.captured ? 'hint capture' : 'hint'} />}
          {premoveDest && <span className={piece ? 'hint capture premove-hint' : 'hint premove-hint'} />}
          {col === 0 && <span className="coord rank">{rankOf(sq) + 1}</span>}
          {row === 7 && <span className="coord file">{FILES[fileOf(sq)]}</span>}
        </div>,
      );
    }
  }

  const dragPiece = drag?.moved ? position.board[drag.from] : null;
  const allArrows: Arrow[] = [
    ...arrows.map(([from, to]) => ({ from, to, color: 'hint' as const })),
    ...shapes.arrows,
    ...(drawing && drawing.from !== drawing.to ? [{ from: drawing.from, to: drawing.to, color: drawing.color }] : []),
  ];

  return (
    <div
      ref={boardRef}
      className={`board${disabled && !premoving ? ' disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        updateDrag(null);
        updateDrawing(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {squares}
      {(allArrows.length > 0 || shapes.circles.length > 0) && (
        <ShapeLayer arrows={allArrows} circles={shapes.circles} preview={drawing} flipped={flipped} />
      )}
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

const COLORS: readonly ShapeColor[] = ['green', 'red', 'blue', 'yellow', 'hint'];

/** Arrows and circles in board coordinates (one unit per square), drawn above the pieces. */
function ShapeLayer({
  arrows,
  circles,
  preview,
  flipped,
}: {
  arrows: readonly Arrow[];
  circles: readonly Circle[];
  preview: Drawing | null;
  flipped: boolean;
}) {
  const center = (sq: Square) => {
    const col = flipped ? 7 - fileOf(sq) : fileOf(sq);
    const row = flipped ? rankOf(sq) : 7 - rankOf(sq);
    return [col + 0.5, row + 0.5] as const;
  };
  const isPreview = (a: Arrow) =>
    preview !== null && a.from === preview.from && a.to === preview.to && a === arrows.at(-1);
  return (
    <svg className="arrows" viewBox="0 0 8 8" aria-hidden="true">
      <defs>
        {COLORS.map((c) => (
          <marker
            key={c}
            id={`arrowhead-${c}`}
            viewBox="0 0 4 4"
            refX="2"
            refY="2"
            markerWidth="3"
            markerHeight="3"
            orient="auto"
          >
            <path d="M0 0 L4 2 L0 4 Z" className={`arrow-head ${c}`} />
          </marker>
        ))}
      </defs>
      {circles.map(({ sq, color }) => {
        const [cx, cy] = center(sq);
        return <circle key={`c${sq}`} cx={cx} cy={cy} r={0.45} className={`shape-circle ${color}`} />;
      })}
      {arrows.map((a, i) => {
        const [x1, y1] = center(a.from);
        const [x2, y2] = center(a.to);
        // Stop short of the target centre so the head sits on the square.
        const len = Math.hypot(x2 - x1, y2 - y1);
        const k = len > 0 ? (len - 0.3) / len : 1;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x1 + (x2 - x1) * k}
            y2={y1 + (y2 - y1) * k}
            className={`arrow-line ${a.color}${isPreview(a) ? ' preview' : ''}`}
            markerEnd={`url(#arrowhead-${a.color})`}
          />
        );
      })}
    </svg>
  );
}
