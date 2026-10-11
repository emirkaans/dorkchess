import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useI18n } from '../i18n.tsx';
import { ROOT, isMainLine, lineEnd, plyOf, promote, removeFrom } from './tree.ts';
import type { MoveTree } from './tree.ts';

/**
 * Arrow keys walk the tree: left / right one move back / forward (forward
 * follows the current line), Home or up to the start, End or down to the end of the line.
 */
export function useTreeKeys(tree: MoveTree | null, setCurrent: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    if (!tree) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.closest('.board')) return; // the board uses arrow keys itself
      const steps: Record<string, (c: number) => number> = {
        ArrowLeft: (c) => tree.nodes[c].parent ?? c,
        ArrowRight: (c) => tree.nodes[c].children[0] ?? c,
        ArrowUp: () => ROOT,
        Home: () => ROOT,
        ArrowDown: (c) => lineEnd(tree, c),
        End: (c) => lineEnd(tree, c),
      };
      const step = steps[e.key];
      if (!step) return;
      e.preventDefault();
      setCurrent((c) => (tree.nodes[c] ? step(c) : c));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tree, setCurrent]);
}

const Icon = ({ d }: { d: string }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

interface Props {
  tree: MoveTree;
  current: number;
  onSelect: (id: number) => void;
  /** Replaces the tree (promote / delete a variation). */
  onTree: (tree: MoveTree, current: number) => void;
  flipped: boolean;
  onFlip: () => void;
}

/** Navigation under the move list, plus "promote" / "delete" while a variation is shown. */
export function TreeNav({ tree, current, onSelect, onTree, flipped, onFlip }: Props) {
  const { t } = useI18n();
  const node = tree.nodes[current];
  const end = lineEnd(tree, current);
  const inVariation = !isMainLine(tree, current);
  return (
    <>
      <div className="viewer-nav">
        <button
          onClick={() => onSelect(ROOT)}
          disabled={current === ROOT}
          aria-label={t('nav.first')}
          title={t('nav.first')}
        >
          <Icon d="M6 5v14M18 5l-8 7 8 7" />
        </button>
        <button
          onClick={() => onSelect(node.parent ?? current)}
          disabled={node.parent === null}
          aria-label={t('nav.back')}
          title={t('nav.back')}
        >
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <span className="replay-pos">
          {plyOf(tree, current)}/{plyOf(tree, end)}
        </span>
        <button
          onClick={() => onSelect(node.children[0] ?? current)}
          disabled={!node.children.length}
          aria-label={t('nav.forward')}
          title={t('nav.forward')}
        >
          <Icon d="M9 5l7 7-7 7" />
        </button>
        <button
          onClick={() => onSelect(end)}
          disabled={end === current}
          aria-label={t('nav.last')}
          title={t('nav.last')}
        >
          <Icon d="M18 5v14M6 5l8 7-8 7" />
        </button>
        <button onClick={onFlip} aria-label={t('controls.flip')} title={t('controls.flip')} aria-pressed={flipped}>
          <Icon d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
        </button>
      </div>
      {inVariation && (
        <div className="variation-actions">
          <button onClick={() => onTree(promote(tree, current), current)}>
            <Icon d="M12 19V5M6 11l6-6 6 6" />
            {t('tree.promote')}
          </button>
          <button
            onClick={() => {
              // As on lichess: this move and everything after it.
              const r = removeFrom(tree, current);
              onTree(r.tree, r.current);
            }}
          >
            <Icon d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3" />
            {t('tree.delete')}
          </button>
        </div>
      )}
    </>
  );
}
