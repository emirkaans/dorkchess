import { describe, expect, it } from 'vitest';
import {
  EARLY_DRAW_PLIES,
  TOURNAMENT_TIME_CONTROLS,
  newPlayer,
  onFire,
  pairings,
  resultFor,
  scored,
  standings,
  tournamentNameProblem,
} from '../src/online/tournament.ts';
import type { TournamentPlayer } from '../src/online/tournament.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

const play = (p: TournamentPlayer, results: ('w' | 'd' | 'l')[], plies = 40) =>
  results.reduce((q, r, i) => scored(q, `g${i}`, r, plies), p);

describe('arena tournaments', () => {
  it('scores 2 / 1 / 0, doubled on fire after two wins in a row', () => {
    const p = play(newPlayer('a', 'Ada'), ['w', 'w', 'w', 'd', 'w']);
    expect(p.sheet.map((s) => s.pts)).toEqual([2, 2, 4, 2, 2]);
    expect(p.sheet.map((s) => s.fire)).toEqual([false, false, true, true, false]);
    expect(p.score).toBe(12);
    expect(onFire(play(newPlayer('a', 'Ada'), ['w', 'w']))).toBe(true);
    expect(onFire(play(newPlayer('a', 'Ada'), ['w', 'w', 'l']))).toBe(false);
  });

  it('gives nothing for an early draw', () => {
    expect(scored(newPlayer('a', 'Ada'), 'g', 'd', EARLY_DRAW_PLIES - 1).score).toBe(0);
    expect(scored(newPlayer('a', 'Ada'), 'g', 'd', EARLY_DRAW_PLIES).score).toBe(1);
  });

  it('ranks by score, then fewer games', () => {
    const a = play(newPlayer('a', 'Ada'), ['w', 'l']);
    const b = play(newPlayer('b', 'Bora'), ['w']);
    const c = play(newPlayer('c', 'Cem'), ['w', 'w']);
    expect(standings([a, b, c]).map((p) => p.userId)).toEqual(['c', 'b', 'a']);
  });

  it('pairs neighbours in the standings, not the last opponent again, and evens out colours', () => {
    const a = { ...play(newPlayer('a', 'Ada'), ['w', 'w']), lastOpponent: 'b', colorBalance: 1 };
    const b = { ...play(newPlayer('b', 'Bora'), ['w']), lastOpponent: 'a', colorBalance: -1 };
    const c = { ...newPlayer('c', 'Cem'), colorBalance: 0 };
    const d = { ...newPlayer('d', 'Deniz'), colorBalance: 0 };
    const pairs = pairings([a, b, c, d], () => 0);
    // Ada (top) skips Bora (last opponent) for Cem; Cem has played Black more, so Cem is White.
    expect(pairs).toEqual([
      ['c', 'a'],
      ['b', 'd'],
    ]);
    // Two players who just met are paired again when nobody else is free.
    expect(pairings([a, b], () => 0)).toEqual([['b', 'a']]);
    expect(pairings([a], () => 0)).toEqual([]);
  });

  it('knows results, names, time controls and addresses', () => {
    expect(resultFor('w', 'w')).toBe('w');
    expect(resultFor('b', 'w')).toBe('l');
    expect(resultFor('b', null)).toBe('d');
    expect(tournamentNameProblem('Perşembe Punk Gecesi')).toBe(false);
    expect(tournamentNameProblem('ab')).toBe(true);
    expect(tournamentNameProblem('<script>')).toBe(true);
    expect(TOURNAMENT_TIME_CONTROLS).not.toContain('none');
    expect(parseRoute('/tournaments')).toEqual({ kind: 'tournaments', id: null });
    expect(parseRoute('/tournament/AbCd1234')).toEqual({ kind: 'tournaments', id: 'AbCd1234' });
    expect(pathOf({ kind: 'tournaments', id: 'AbCd1234' })).toBe('/tournament/AbCd1234');
  });
});

describe('tournament no-shows', () => {
  it('ends a game nobody started; the idle side is named, and moves made stop it', async () => {
    const { createRoom, joinRoom, noShow, ABORT_PLIES } = await import('../src/online/room.ts');
    const created = createRoom(
      'g1',
      { variantId: 'standard', timeControlId: '3+2', color: 'w', name: 'A' },
      't1',
      () => 0,
    );
    const room = joinRoom(created.room, 'B', 't2').room;
    const over = noShow(room, 1000);
    expect(over.phase).toBe('over');
    expect(over.outcome).toEqual({ reason: 'abandon', winner: 'b' });
    const moved = { ...room, moves: Array.from({ length: ABORT_PLIES }, () => room.moves[0]) };
    expect(noShow(moved as typeof room, 1000)).toBe(moved);
  });
});
