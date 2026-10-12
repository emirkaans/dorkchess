import { describe, expect, it } from 'vitest';
import { isSolutionMove } from '../src/online/puzzle.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('bulmacalar', () => {
  const moves = ['h4g5', 'h1h8', 'e8d7', 'h8d8'];

  it('çözüm hamlesi doğru sayılır; son hamlede başka bir mat da kabul', () => {
    expect(isSolutionMove(moves, 1, 'h1h8', false)).toBe(true);
    expect(isSolutionMove(moves, 1, 'h1h2', false)).toBe(false);
    // A different mate is fine only on the last move.
    expect(isSolutionMove(moves, 1, 'b4b7', true)).toBe(false);
    expect(isSolutionMove(moves, 3, 'b4b7', true)).toBe(true);
    expect(isSolutionMove(moves, 3, 'b4b7', false)).toBe(false);
  });

  it('adresler: /puzzles ve /puzzles/<id>', () => {
    expect(parseRoute('/puzzles')).toEqual({ kind: 'puzzles', id: null });
    expect(parseRoute('/puzzles/puTTs')).toEqual({ kind: 'puzzles', id: 'puTTs' });
    expect(pathOf({ kind: 'puzzles', id: 'puTTs' })).toBe('/puzzles/puTTs');
    expect(pathOf({ kind: 'puzzles', id: null })).toBe('/puzzles');
  });
});
