import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { parseFen, parseSquare } from '../engine/index.ts';
import type { Square, VariantDefinition } from '../engine/index.ts';
import type { RuleExample } from '../rules/cards.ts';
import { Board } from './Board.tsx';

interface Props {
  variant: VariantDefinition;
  example: RuleExample;
  /** Board width in px. */
  size: number;
}

/** Small read-only board: the main Board component, disabled, with highlights and arrows. */
export function Diagram({ variant, example, size }: Props) {
  const position = useMemo(() => parseFen(variant, example.fen), [variant, example.fen]);
  const highlight = useMemo(() => example.highlights.map(parseSquare), [example.highlights]);
  const arrows = useMemo(
    () => example.arrows.map(([from, to]) => [parseSquare(from), parseSquare(to)] as [Square, Square]),
    [example.arrows],
  );
  return (
    <div className="diagram" style={{ '--board': `${size}px` } as CSSProperties}>
      <Board
        variant={variant}
        position={position}
        lastMove={null}
        flipped={false}
        highlight={highlight}
        bandRanks={variant.highlight?.ranks ?? []}
        arrows={arrows}
        disabled
        onMove={() => {}}
      />
    </div>
  );
}
