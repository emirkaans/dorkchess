import { describe, expect, it } from 'vitest';
import { GANG_POINTS, cleanTag, gangProblem, gangScore } from '../src/online/gang.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('gangs', () => {
  it('checks a new gang name and tag', () => {
    expect(gangProblem('Rook Riot', 'rr')).toBeNull();
    expect(gangProblem('ab', 'RR')).toBe('name');
    expect(gangProblem('Rook<Riot>', 'RR')).toBe('name');
    expect(gangProblem('Rook Riot', 'R')).toBe('tag');
    expect(gangProblem('Rook Riot', 'RIOTS')).toBe('tag');
    expect(gangProblem('Rook Riot', 'R-R')).toBe('tag');
    expect(cleanTag(' rr1 ')).toBe('RR1');
  });

  it('scores a week', () => {
    expect(gangScore(0, 0, 0)).toBe(0);
    expect(gangScore(3, 2, 1)).toBe(3 * GANG_POINTS.win + 2 * GANG_POINTS.draw + GANG_POINTS.daily);
  });

  it('routes /gangs and /gang/<TAG>', () => {
    expect(parseRoute('/gangs')).toEqual({ kind: 'gangs', tag: null });
    expect(parseRoute('/gang/rr1')).toEqual({ kind: 'gangs', tag: 'RR1' });
    expect(pathOf({ kind: 'gangs', tag: 'RR1' })).toBe('/gang/RR1');
    expect(pathOf({ kind: 'gangs', tag: null })).toBe('/gangs');
  });
});

describe('static pages', () => {
  it('are not game links, though "licenses" has the length of a game id', () => {
    for (const p of ['/licenses', '/privacy', '/terms']) expect(parseRoute(p).kind).toBe('home');
  });
});
