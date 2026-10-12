import { describe, expect, it } from 'vitest';
import { listVariants } from '../src/engine/index.ts';
import {
  QUICK_VARIANT,
  cleanPlayer,
  gameRequest,
  makeSeek,
  quickMatch,
  quickTimeControls,
  sortSeeks,
} from '../src/online/lobby.ts';
import type { LobbyPlayer, Seek } from '../src/online/lobby.ts';
import { createRoom, joinRoom } from '../src/online/room.ts';

const alice: LobbyPlayer = { id: 'alice-0001', name: 'Alice', rating: null };
const bob: LobbyPlayer = { id: 'bob-000001', name: 'Bob', rating: null };

const seek = (id: string, player: LobbyPlayer, tc: string, quick: boolean, at: number): Seek =>
  makeSeek(id, player, { variantId: QUICK_VARIANT(), timeControlId: tc, color: 'random' }, quick, at)!;

describe('lobi', () => {
  it('oyuncu kimliği: geçerli id ve temizlenmiş ad; bozuk id reddedilir', () => {
    expect(cleanPlayer('abcdefgh-1234', '  Punk   Kid ')).toEqual({
      id: 'abcdefgh-1234',
      name: 'Punk Kid',
      rating: null,
    });
    expect(cleanPlayer('abcdefgh', '')?.name).toBe('punk');
    expect(cleanPlayer('kısa', 'x')).toBeNull();
    expect(cleanPlayer('bad id with spaces', 'x')).toBeNull();
    expect(cleanPlayer(42, 'x')).toBeNull();
  });

  it('ilan: bilinmeyen varyant veya süre reddedilir, renk yoksa rastgele', () => {
    const v = listVariants()[1].id;
    expect(makeSeek('s1', alice, { variantId: v, timeControlId: '3+2', color: 'b' }, false, 1)).toMatchObject({
      variantId: v,
      timeControlId: '3+2',
      color: 'b',
      quick: false,
    });
    expect(makeSeek('s1', alice, { variantId: v, timeControlId: '3+2', color: 'mor' }, false, 1)?.color).toBe('random');
    expect(makeSeek('s1', alice, { variantId: 'yok', timeControlId: '3+2', color: 'w' }, false, 1)).toBeNull();
    expect(makeSeek('s1', alice, { variantId: v, timeControlId: '7+7', color: 'w' }, false, 1)).toBeNull();
  });

  it('hızlı eşleşme: aynı süredeki en eski hızlı ilan, kendi ilanı ve lobi ilanları hariç', () => {
    const seeks = [
      seek('a', alice, '3+2', true, 5),
      seek('b', bob, '3+2', true, 3),
      seek('c', bob, '3+2', false, 1),
      seek('d', bob, '5+0', true, 1),
    ];
    expect(quickMatch(seeks, '3+2', 'someone-else')?.id).toBe('b');
    expect(quickMatch(seeks, '3+2', bob.id)?.id).toBe('a');
    expect(quickMatch(seeks, '10+0', alice.id)).toBeNull();
  });

  it('hızlı eşleşmede yalnızca saatli süreler var', () => {
    expect(quickTimeControls(['none', '1+0', '3+2'])).toEqual(['1+0', '3+2']);
  });

  it('eşleşme: ilan sahibinin rengi korunur, rastgele ise seçilir; oda iki oyuncuyla başlar', () => {
    const fixed = makeSeek('x', alice, { variantId: QUICK_VARIANT(), timeControlId: '5+0', color: 'b' }, false, 1)!;
    expect(gameRequest(fixed, () => 0).color).toBe('b');
    const random = seek('y', alice, '5+0', true, 1);
    expect(gameRequest(random, () => 0.1).color).toBe('w');
    expect(gameRequest(random, () => 0.9).color).toBe('b');

    const req = gameRequest(fixed, Math.random);
    const created = createRoom('ABCDEFGH', req, 'token-a', Math.random);
    const joined = joinRoom(created.room, bob.name, 'token-b');
    expect(created.color).toBe('b');
    expect(joined.color).toBe('w');
    expect(joined.room.phase).toBe('playing');
    expect(joined.room.seats.b?.name).toBe('Alice');
    expect(joined.room.seats.w?.name).toBe('Bob');
  });

  it('lobi listesi eskiden yeniye sıralı', () => {
    const list = sortSeeks([seek('n', alice, '1+0', false, 9), seek('o', bob, '1+0', false, 2)]);
    expect(list.map((s) => s.id)).toEqual(['o', 'n']);
  });

  it('puanlı ilan yalnızca hesaplı oyuncudan ve saatli oyunda; hızlı eşleşme hesaplıyı hesaplıyla eşler', () => {
    const acc = { ...alice, account: true };
    const v = QUICK_VARIANT();
    expect(makeSeek('r1', acc, { variantId: v, timeControlId: '3+2', color: 'w', rated: true }, false, 1)?.rated).toBe(
      true,
    );
    expect(
      makeSeek('r2', alice, { variantId: v, timeControlId: '3+2', color: 'w', rated: true }, false, 1)?.rated,
    ).toBe(false);
    expect(makeSeek('r3', acc, { variantId: v, timeControlId: 'none', color: 'w', rated: true }, false, 1)?.rated).toBe(
      false,
    );
    const guest = seek('g', bob, '1+0', true, 1);
    const ratedQuick = makeSeek(
      'q',
      acc,
      { variantId: v, timeControlId: '1+0', color: 'random', rated: true },
      true,
      2,
    )!;
    expect(quickMatch([guest, ratedQuick], '1+0', 'someone', true)?.id).toBe('q');
    expect(quickMatch([guest, ratedQuick], '1+0', 'someone', false)?.id).toBe('g');
  });
});
