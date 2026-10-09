import type { GameState } from '../engine/index.ts';

interface Props {
  /** Latest state of the timeline (holds every played move). */
  game: GameState;
  /** Number of moves currently shown on the board. */
  cursor: number;
  onSelect: (cursor: number) => void;
}

export function MoveList({ game, cursor, onSelect }: Props) {
  // Number moves from the first state's move number and side.
  let first: GameState = game;
  while (first.previous) first = first.previous;
  const startNumber = first.position.fullmove;
  const blackFirst = first.position.turn === 'b';

  const rows: { n: number; cells: ({ san: string; index: number } | null)[] }[] = [];
  game.moves.forEach((m, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const n = startNumber + Math.floor(ply / 2);
    if (ply % 2 === 0 || rows.length === 0) rows.push({ n, cells: ply % 2 === 0 ? [] : [null] });
    rows[rows.length - 1].cells.push({ san: m.san, index: i });
  });

  if (!rows.length) return <p className="muted">Henüz hamle yok.</p>;

  return (
    <ol className="moves">
      {rows.map((row) => (
        <li key={row.n}>
          <span className="num">{row.n}.</span>
          {row.cells.map((c, j) =>
            c ? (
              <button
                key={j}
                className={c.index === cursor - 1 ? 'mv current' : 'mv'}
                onClick={() => onSelect(c.index + 1)}
              >
                {c.san}
              </button>
            ) : (
              <span key={j} className="mv">
                …
              </span>
            ),
          )}
        </li>
      ))}
    </ol>
  );
}
