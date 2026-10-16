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
  swissBye,
  swissPairings,
  swissScored,
  swissStandings,
  buchholz,
  tournamentNameProblem,
} from '../src/online/tournament.ts';
import { scoreText } from '../src/ui/TournamentsPage.tsx';
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

describe('swiss tournaments', () => {
  const group = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, newPlayer(n, n)])) as Record<string, TournamentPlayer>;
  const meet = (all: Record<string, TournamentPlayer>, a: string, b: string, r: 'w' | 'd' | 'l') => {
    all[a] = { ...swissScored(all[a], `${a}${b}`, r), opponents: [...(all[a].opponents ?? []), b] };
    const back = r === 'w' ? 'l' : r === 'l' ? 'w' : 'd';
    all[b] = { ...swissScored(all[b], `${a}${b}`, back), opponents: [...(all[b].opponents ?? []), a] };
  };

  it('scores 1 / ½ / 0 and a bye 1', () => {
    expect(swissScored(newPlayer('a', 'A'), 'g', 'w').score).toBe(1);
    expect(swissScored(newPlayer('a', 'A'), 'g', 'd').score).toBe(0.5);
    expect(swissScored(newPlayer('a', 'A'), 'g', 'l').score).toBe(0);
    const bye = swissBye(newPlayer('a', 'A'));
    expect([bye.score, bye.byes, bye.sheet[0].r]).toEqual([1, 1, 'b']);
    expect([scoreText(0.5), scoreText(2.5), scoreText(3)]).toEqual(['½', '2½', '3']);
  });

  it('pairs everyone once a round, the odd one out with a bye, never twice the same pair', () => {
    const all = group('a', 'b', 'c', 'd', 'e');
    const first = swissPairings(Object.values(all), all, Math.random);
    expect(first.pairs).toHaveLength(2);
    expect(first.bye).not.toBeNull();
    const seen = new Set<string>();
    // Round after round with fixed results: no pair repeats while one can be avoided.
    for (let round = 0; round < 4; round++) {
      const { pairs, bye } = swissPairings(Object.values(all), all, () => 0.3);
      if (bye) all[bye] = swissBye(all[bye]);
      for (const [w, b] of pairs) {
        const key = [w, b].sort().join('-');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        meet(all, w, b, 'w');
      }
    }
    // Five players, four rounds: everyone had at most one bye.
    expect(Object.values(all).every((p) => (p.byes ?? 0) <= 1)).toBe(true);
  });

  it('pairs leaders together and breaks ties by Buchholz', () => {
    const all = group('a', 'b', 'c', 'd');
    meet(all, 'a', 'c', 'w');
    meet(all, 'b', 'd', 'w');
    const { pairs } = swissPairings(Object.values(all), all, () => 0.3);
    const together = pairs.map((p) => [...p].sort().join('-'));
    expect(together).toContain('a-b');
    expect(together).toContain('c-d');
    meet(all, 'a', 'b', 'd');
    meet(all, 'c', 'd', 'w');
    // a and b both 1½; a beat c (1 point), b beat d (0): a ahead on Buchholz.
    expect(buchholz(all.a, all)).toBeGreaterThan(buchholz(all.b, all));
    expect(
      swissStandings(all)
        .map((p) => p.userId)
        .slice(0, 2),
    ).toEqual(['a', 'b']);
  });
});

describe('spray tags', () => {
  it('has five open styles and ten earned ones, the mates counting', async () => {
    const { TAG_STYLES, tagOpen, tagById, seeded } = await import('../src/achievements/tags.ts');
    expect(TAG_STYLES).toHaveLength(15);
    expect(TAG_STYLES.filter((s) => !s.need)).toHaveLength(5);
    const none = { patches: 0, games: 0, bestRating: null, rushBest: 0, dailyBest: 0, mates: 0 };
    expect(TAG_STYLES.filter((s) => tagOpen(s, none))).toHaveLength(5);
    expect(tagOpen(tagById('crowned'), { ...none, mates: 1 })).toBe(true);
    expect(tagById('nope').id).toBe('riot');
    // The same name sprays the same way.
    expect(seeded('AdaPunk')()).toBe(seeded('AdaPunk')());
  });
});
