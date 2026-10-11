// Move tree for analysis: a game's main line plus side variations, as on
// lichess. Each node is a position; its first child continues the line it is
// on, further children are alternatives (variations). Pure: no React, no DOM.

import { makeMove } from '../../engine/index.ts';
import type { GameState, Move, VariantDefinition } from '../../engine/index.ts';

export interface TreeNode {
  readonly id: number;
  readonly state: GameState;
  readonly parent: number | null;
  /** First child: the continuation; the others: variations. */
  readonly children: readonly number[];
}

export interface MoveTree {
  readonly nodes: Readonly<Record<number, TreeNode>>;
  readonly nextId: number;
}

export const ROOT = 0;

/** A tree holding one line; node ids are the indices of `states` (0 = start). */
export function treeOf(states: readonly GameState[]): MoveTree {
  const nodes: Record<number, TreeNode> = {};
  states.forEach((state, i) => {
    nodes[i] = { id: i, state, parent: i === 0 ? null : i - 1, children: i + 1 < states.length ? [i + 1] : [] };
  });
  return { nodes, nextId: states.length };
}

const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && a.promotion === b.promotion;

/** Plays `move` after `parentId`: an existing child with that move is reused, otherwise a new variation is added. */
export function addMove(
  tree: MoveTree,
  v: VariantDefinition,
  parentId: number,
  move: Move,
): { tree: MoveTree; id: number } {
  const parent = tree.nodes[parentId];
  const existing = parent.children.find((c) => {
    const last = tree.nodes[c].state.moves.at(-1)?.move;
    return last !== undefined && sameMove(last, move);
  });
  if (existing !== undefined) return { tree, id: existing };
  const id = tree.nextId;
  const state = makeMove(v, parent.state, move);
  return {
    id,
    tree: {
      nextId: id + 1,
      nodes: {
        ...tree.nodes,
        [parentId]: { ...parent, children: [...parent.children, id] },
        [id]: { id, state, parent: parentId, children: [] },
      },
    },
  };
}

/** Node ids from the start to `id`. */
export function pathTo(tree: MoveTree, id: number): number[] {
  const out: number[] = [];
  for (let n: number | null = id; n !== null; n = tree.nodes[n].parent) out.push(n);
  return out.reverse();
}

/** Positions from the start to `id`. */
export const statesTo = (tree: MoveTree, id: number) => pathTo(tree, id).map((n) => tree.nodes[n].state);

/** Moves played to reach `id`. */
export const plyOf = (tree: MoveTree, id: number) => pathTo(tree, id).length - 1;

/** Follows first children from `id` to the end of its line. */
export function lineEnd(tree: MoveTree, id: number): number {
  let n = id;
  while (tree.nodes[n].children.length) n = tree.nodes[n].children[0];
  return n;
}

/** The main line: first children from the start. */
export function mainLine(tree: MoveTree): number[] {
  const out = [ROOT];
  while (tree.nodes[out[out.length - 1]].children.length) out.push(tree.nodes[out[out.length - 1]].children[0]);
  return out;
}

/** Is `id` on the main line? */
export function isMainLine(tree: MoveTree, id: number): boolean {
  for (let n = id; tree.nodes[n].parent !== null; n = tree.nodes[n].parent!) {
    if (tree.nodes[tree.nodes[n].parent!].children[0] !== n) return false;
  }
  return true;
}

/** Makes the line through `id` the main line (each branch on the way becomes the first child). */
export function promote(tree: MoveTree, id: number): MoveTree {
  const nodes = { ...tree.nodes };
  for (let n = id; nodes[n].parent !== null; n = nodes[n].parent!) {
    const p = nodes[nodes[n].parent!];
    if (p.children[0] !== n) nodes[p.id] = { ...p, children: [n, ...p.children.filter((c) => c !== n)] };
  }
  return { ...tree, nodes };
}

/** Deletes `id` and everything after it; returns the tree and the node to show next (its parent). */
export function removeFrom(tree: MoveTree, id: number): { tree: MoveTree; current: number } {
  const parentId = tree.nodes[id].parent;
  if (parentId === null) return { tree, current: id };
  const nodes = { ...tree.nodes };
  const drop = (n: number) => {
    for (const c of nodes[n].children) drop(c);
    delete nodes[n];
  };
  drop(id);
  nodes[parentId] = { ...nodes[parentId], children: nodes[parentId].children.filter((c) => c !== id) };
  return { tree: { ...tree, nodes }, current: parentId };
}

/** SAN of the move that led to `id` ('' for the start). */
export const sanOf = (tree: MoveTree, id: number) => tree.nodes[id].state.moves.at(-1)?.san ?? '';
