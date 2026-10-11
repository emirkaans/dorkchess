// Move tree for analysis: main line, variations, promote and delete.

import { describe, expect, it } from 'vitest';
import { parseSquare } from '../src/engine/board.ts';
import { createGame, findMove, playSan } from '../src/engine/game.ts';
import { getVariant } from '../src/engine/variants/index.ts';
import {
  ROOT,
  addMove,
  isMainLine,
  lineEnd,
  mainLine,
  pathTo,
  plyOf,
  promote,
  removeFrom,
  sanOf,
  statesTo,
  treeOf,
} from '../src/ui/analysis/tree.ts';
import type { MoveTree } from '../src/ui/analysis/tree.ts';

const v = getVariant('standard');
const line = (...sans: string[]) => {
  const out = [createGame(v)];
  for (const san of sans) out.push(playSan(v, out[out.length - 1], san));
  return out;
};
const play = (tree: MoveTree, at: number, from: string, to: string) =>
  addMove(tree, v, at, findMove(v, tree.nodes[at].state, parseSquare(from), parseSquare(to))!);
const sans = (tree: MoveTree, ids: number[]) => ids.slice(1).map((id) => sanOf(tree, id));

describe('hamle ağacı', () => {
  it('bir oyundan ana hat kurulur; düğüm numaraları konum sırasıdır', () => {
    const tree = treeOf(line('e4', 'e5', 'Nf3'));
    expect(sans(tree, mainLine(tree))).toEqual(['e4', 'e5', 'Nf3']);
    expect(plyOf(tree, 3)).toBe(3);
    expect(lineEnd(tree, ROOT)).toBe(3);
  });

  it('başka hamle yan varyant açar, ana hat korunur; aynı hamle yeniden kullanılır', () => {
    let tree = treeOf(line('e4', 'e5', 'Nf3'));
    const r = play(tree, 2, 'f2', 'f4'); // 2. f4 instead of 2. Nf3
    tree = r.tree;
    expect(sans(tree, mainLine(tree))).toEqual(['e4', 'e5', 'Nf3']);
    expect(sans(tree, pathTo(tree, r.id))).toEqual(['e4', 'e5', 'f4']);
    expect(isMainLine(tree, r.id)).toBe(false);
    expect(play(tree, 2, 'g1', 'f3').id).toBe(3); // the main line move
    expect(play(tree, 2, 'f2', 'f4').id).toBe(r.id);
    // A variation can go on and branch again.
    const deeper = play(tree, r.id, 'e5', 'f4');
    expect(sans(deeper.tree, pathTo(deeper.tree, deeper.id))).toEqual(['e4', 'e5', 'f4', 'exf4']);
    expect(statesTo(deeper.tree, deeper.id)).toHaveLength(5);
  });

  it('varyant ana hatta yükseltilir ve silinir', () => {
    let tree = treeOf(line('e4', 'e5', 'Nf3'));
    const f4 = play(tree, 2, 'f2', 'f4');
    const exf4 = play(f4.tree, f4.id, 'e5', 'f4');
    tree = promote(exf4.tree, exf4.id);
    expect(sans(tree, mainLine(tree))).toEqual(['e4', 'e5', 'f4', 'exf4']);
    expect(isMainLine(tree, 3)).toBe(false);
    const removed = removeFrom(tree, f4.id);
    expect(removed.current).toBe(2);
    expect(sans(removed.tree, mainLine(removed.tree))).toEqual(['e4', 'e5', 'Nf3']);
    expect(removed.tree.nodes[exf4.id]).toBeUndefined();
  });
});
