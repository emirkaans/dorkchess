import { findMove, makeMove, moveToSan } from '../../engine/index.ts';
import type { GameState, Move, VariantDefinition } from '../../engine/index.ts';
import type { LineMove } from '../../ai/search.ts';

interface Props {
  variant: VariantDefinition;
  /** Position the line starts from. */
  state: GameState;
  line: readonly LineMove[];
  /** Plays the line up to (and including) the clicked move. */
  onPlay: (moves: Move[]) => void;
}

/** The engine's line as SAN ("11. Bg5+ Nf6 12. Nf5#"); a click plays it up to that move. */
export function EngineLine({ variant, state, line, onPlay }: Props) {
  const moves: { move: Move; san: string; num: string | null }[] = [];
  let s = state;
  // At most ten plies: a longer line is guesswork and does not fit.
  for (const m of line.slice(0, 10)) {
    const move = findMove(variant, s, m.from, m.to, m.promotion);
    if (!move) break;
    const { turn, fullmove } = s.position;
    const num = turn === 'w' ? `${fullmove}.` : moves.length === 0 ? `${fullmove}...` : null;
    moves.push({ move, san: moveToSan(variant, s.position, move), num });
    s = makeMove(variant, s, move);
    if (s.result) break;
  }
  if (!moves.length) return null;
  return (
    <span className="engine-line">
      {moves.map((m, i) => (
        <span key={i}>
          {m.num && <span className="var-num">{m.num}</span>}
          <button className="mv var" onClick={() => onPlay(moves.slice(0, i + 1).map((x) => x.move))}>
            {m.san}
          </button>
        </span>
      ))}
    </span>
  );
}
