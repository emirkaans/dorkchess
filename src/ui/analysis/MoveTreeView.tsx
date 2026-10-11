import type { ReactNode } from 'react';
import { useI18n } from '../i18n.tsx';
import { ROOT, mainLine, sanOf } from './tree.ts';
import type { MoveTree } from './tree.ts';

interface Props {
  tree: MoveTree;
  /** Node shown on the board. */
  current: number;
  onSelect: (id: number) => void;
  /** Extra class per node (e.g. 'blunder' / 'mistake' from the analysis). */
  marks?: ReadonlyMap<number, string>;
}

const MARK_TEXT: Record<string, string> = { blunder: '??', mistake: '?', inaccuracy: '?!' };

/**
 * Moves as on lichess: the main line in two columns (move number, White,
 * Black); where it branches, the variations follow on their own lines, inline,
 * with nested variations in parentheses. Every move is a button.
 */
export function MoveTreeView({ tree, current, onSelect, marks }: Props) {
  const { t } = useI18n();
  const main = mainLine(tree);
  if (main.length === 1 && tree.nodes[ROOT].children.length === 0) return <p className="muted">{t('moves.none')}</p>;

  const move = (id: number, extra = '') => {
    const mark = marks?.get(id) ?? '';
    return (
      <button
        key={id}
        className={['mv', extra, mark, id === current ? 'current' : ''].filter(Boolean).join(' ')}
        onClick={() => onSelect(id)}
      >
        {sanOf(tree, id)}
        {MARK_TEXT[mark] ?? ''}
      </button>
    );
  };

  /** Move number in front of a move: "5." before White, "5..." before Black when it starts a run. */
  const number = (id: number, startOfRun: boolean): string | null => {
    const parent = tree.nodes[tree.nodes[id].parent!].state.position;
    if (parent.turn === 'w') return `${parent.fullmove}.`;
    return startOfRun ? `${parent.fullmove}...` : null;
  };

  /** One variation from `start` on, inline; its own branches go in parentheses. */
  const inline = (start: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let id: number | undefined = start;
    let startOfRun = true;
    while (id !== undefined) {
      const n: number = id;
      const num = number(n, startOfRun);
      if (num)
        out.push(
          <span key={`n${n}`} className="var-num">
            {num}
          </span>,
        );
      out.push(move(n, 'var'));
      startOfRun = false;
      const parent = tree.nodes[tree.nodes[n].parent!];
      // Alternatives to this move (when it continues the variation, not when it starts it).
      if (n !== start && parent.children.length > 1) {
        for (const alt of parent.children.slice(1)) {
          out.push(
            <span key={`p${alt}`} className="var-paren">
              ({inline(alt)})
            </span>,
          );
        }
        startOfRun = true;
      }
      id = tree.nodes[n].children[0];
    }
    return out;
  };

  // Main line rows; a branch closes the row and its variations follow underneath.
  const rows: ReactNode[] = [];
  let row: { num: number; white: number | null; black: number | null } | null = null;
  const flush = () => {
    if (!row) return;
    const r = row;
    rows.push(
      <li key={`r${r.white ?? r.black}`} className="tree-row">
        <span className="num">{r.num}.</span>
        {r.white !== null ? move(r.white) : <span className="mv-gap">…</span>}
        {r.black !== null ? move(r.black) : <span className="mv-gap" />}
      </li>,
    );
    row = null;
  };
  for (let k = 1; k < main.length; k++) {
    const id = main[k];
    const parent = tree.nodes[main[k - 1]];
    const { turn, fullmove } = parent.state.position;
    if (turn === 'w') {
      flush();
      row = { num: fullmove, white: id, black: null };
    } else if (row && row.black === null && row.num === fullmove) row.black = id;
    else {
      flush();
      row = { num: fullmove, white: null, black: id };
    }
    const alts = parent.children.slice(1);
    if (alts.length) {
      flush();
      rows.push(
        <li key={`v${id}`} className="tree-vars">
          {alts.map((alt) => (
            <div key={alt} className="tree-var">
              {inline(alt)}
            </div>
          ))}
        </li>,
      );
    }
  }
  flush();
  return <ol className="moves move-tree">{rows}</ol>;
}
