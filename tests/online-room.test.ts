// Online game rules (src/online/room.ts): seats, setup, moves, clock, draws,
// resignation and the 15-second reconnect rule. Pure functions, fake time.

import { describe, expect, it } from 'vitest';
import { parseSquare } from '../src/engine/board.ts';
import { reconnectMs } from '../src/online/protocol.ts';
import { timeControl } from '../src/clock/clock.ts';

/** 5+0, the time control of newGame(): 30 seconds to come back. */
const RECONNECT_MS = 30_000;
import type { WireMove } from '../src/online/protocol.ts';
import {
  RoomError,
  answerSetup,
  createRoom,
  draw,
  gameOf,
  joinRoom,
  nextDeadline,
  playMove,
  rematch,
  resign,
  seatOf,
  setConnected,
  tick,
  viewOf,
} from '../src/online/room.ts';
import type { Room } from '../src/online/room.ts';

const mv = (from: string, to: string, promotion?: string): WireMove =>
  promotion
    ? { from: parseSquare(from), to: parseSquare(to), promotion }
    : { from: parseSquare(from), to: parseSquare(to) };

function newGame(variantId = 'standard', timeControlId = '5+0') {
  const { room, color } = createRoom(
    'Abcd1234',
    { variantId, timeControlId, color: 'w', name: '  Ayşe  ' },
    'tw',
    () => 0,
  );
  expect(color).toBe('w');
  return joinRoom(room, 'Bora', 'tb').room;
}

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof RoomError) return e.code;
    throw e;
  }
  return null;
};

describe('online oda', () => {
  it('kurulum: ikinci oyuncu boş koltuğa oturur, üçüncüsü giremez, isimler temizlenir', () => {
    const room = newGame();
    expect(room.phase).toBe('playing');
    expect(room.seats.w?.name).toBe('Ayşe');
    expect(seatOf(room, 'tb')).toBe('b');
    expect(seatOf(room, 'nope')).toBeNull();
    expect(code(() => joinRoom(room, 'Can', 'tc'))).toBe('full');
  });

  it('hamleler: sıra ve ply kontrolü, yasadışı hamle reddedilir', () => {
    let room = newGame();
    expect(code(() => playMove(room, 'b', mv('e7', 'e5'), 0, 1000))).toBe('not-your-turn');
    expect(code(() => playMove(room, 'w', mv('e2', 'e5'), 0, 1000))).toBe('illegal');
    room = playMove(room, 'w', mv('e2', 'e4'), 0, 1000);
    expect(code(() => playMove(room, 'b', mv('e7', 'e5'), 0, 2000))).toBe('not-your-turn'); // stale ply
    room = playMove(room, 'b', mv('e7', 'e5'), 1, 2000);
    expect(gameOf(room)!.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('mat oyunu bitirir', () => {
    let room = newGame();
    const line = [mv('f2', 'f3'), mv('e7', 'e5'), mv('g2', 'g4'), mv('d8', 'h4')];
    line.forEach((m, i) => (room = playMove(room, i % 2 ? 'b' : 'w', m, i, 1000 + i)));
    expect(room.phase).toBe('over');
    expect(room.outcome).toEqual({ reason: 'checkmate', winner: 'b' });
    expect(code(() => resign(room, 'w', 5000))).toBe('over');
  });

  it('saat: ilk hamle saati başlatır, süre bitince alarm oyunu bitirir', () => {
    let room = newGame('standard', '1+0');
    expect(nextDeadline(room)).toBeNull();
    room = playMove(room, 'w', mv('e2', 'e4'), 0, 10_000);
    expect(nextDeadline(room)).toBe(10_000 + 60_000);
    expect(tick(room, 69_999).phase).toBe('playing');
    const over = tick(room, 70_000);
    expect(over.outcome).toEqual({ reason: 'timeout', winner: 'w' });
  });

  it('kopma: süresi içinde (5+0: 30 sn) dönmeyen kaybeder, saat bu arada işler; dönerse sayaç iptal', () => {
    let room = playMove(newGame(), 'w', mv('e2', 'e4'), 0, 0);
    room = setConnected(room, 'b', false, 1000);
    expect(nextDeadline(room)).toBe(1000 + RECONNECT_MS);
    const view = viewOf(room, 'w', { w: true, b: false }, 2000);
    expect(view.players.b).toEqual({
      name: 'Bora',
      connected: false,
      deadline: 1000 + RECONNECT_MS,
      // A guest: no account, no rating, no spray tag.
      username: null,
      rating: null,
      provisional: false,
      diff: null,
      newPatches: [],
      tag: null,
    });
    expect(JSON.stringify(view)).not.toContain('tb'); // tokens never leave the server

    expect(tick(room, 1000 + RECONNECT_MS - 1).phase).toBe('playing');
    expect(tick(room, 1000 + RECONNECT_MS).outcome).toEqual({ reason: 'abandon', winner: 'w' });

    const back = setConnected(room, 'b', true, 5000);
    expect(back.gone).toEqual({});
    expect(tick(back, 1000 + RECONNECT_MS).phase).toBe('playing');
    // The clock kept running for Black while away.
    expect(back.clock.running).toBe('b');
  });

  it('beraberlik teklifi, kabul, ret ve hamleyle düşen teklif; teslim', () => {
    let room = playMove(newGame(), 'w', mv('e2', 'e4'), 0, 0);
    room = draw(room, 'w', 'offer', 100);
    expect(room.drawOffer).toBe('w');
    expect(draw(room, 'b', 'decline', 200).drawOffer).toBeNull();
    expect(playMove(room, 'b', mv('e7', 'e5'), 1, 300).drawOffer).toBeNull();
    expect(draw(room, 'b', 'accept', 400).outcome).toEqual({ reason: 'agreement', winner: null });
    expect(resign(room, 'b', 500).outcome).toEqual({ reason: 'resign', winner: 'w' });
  });

  it('kurulum soruları (Jester): her taraf kendi sorusunu yanıtlar, iki yanıt gelince oyun başlar', () => {
    const { room: created } = createRoom(
      'Jstr1234',
      { variantId: 'jester', timeControlId: 'none', color: 'b', name: 'A' },
      'tb',
      () => 0,
    );
    let room: Room = joinRoom(created, 'B', 'tw').room;
    expect(room.phase).toBe('setup');
    const v = viewOf(room, 'w', { w: true, b: true }, 0);
    expect(v.answered).toEqual([]);
    expect(code(() => answerSetup(room, 'w', { nope: 'x' }))).toBe('bad-request');
    room = answerSetup(room, 'w', { w: 'd' });
    expect(room.phase).toBe('setup');
    room = answerSetup(room, 'b', { b: 'd' });
    expect(room.phase).toBe('playing');
    expect(room.answers).toEqual({ w: 'd', b: 'd' });
    expect(gameOf(room)!.moves).toEqual([]);
  });

  it('rövanş: bir taraf ister, öteki kabul edince renkler değişmiş yeni oda kurulur', () => {
    let room = resign(playMove(newGame(), 'w', mv('e2', 'e4'), 0, 0), 'b', 100);
    expect(rematch(room, 'w', 'offer', 'Next1234').next).toBeNull();
    room = rematch(room, 'w', 'offer', 'Next1234').room;
    expect(viewOf(room, 'b', { w: true, b: true }, 0).rematchOffer).toBe('w');
    const r = rematch(room, 'b', 'accept', 'Next1234');
    expect(r.room.rematchId).toBe('Next1234');
    expect(r.next).toMatchObject({ id: 'Next1234', phase: 'playing', moves: [] });
    // Same secrets, colours swapped.
    expect(seatOf(r.next!, 'tw')).toBe('b');
    expect(seatOf(r.next!, 'tb')).toBe('w');
    // Only once, and only after the game.
    expect(rematch(r.room, 'w', 'offer', 'Other123').next).toBeNull();
    expect(rematch(newGame(), 'w', 'offer', 'X1234567').room.rematchOffer).toBeUndefined();
  });

  it('kopma süresi tempoya göre: 3+2ye kadar 15 sn, 5 dakikada 30 sn, 10 dakika ve üzerinde 1 dk', () => {
    const secs = (id: string) => reconnectMs(timeControl(id)) / 1000;
    expect(['1+0', '3+2', '5+0', '10+0', '15+10', 'none'].map(secs)).toEqual([15, 15, 30, 60, 60, 60]);
  });
});

describe('puanlı oyunlar', () => {
  const ada = { id: 'u-ada', username: 'Ada' };
  const bora = { id: 'u-bora', username: 'Bora' };
  const req = (rated: boolean, timeControlId = '5+0') => ({
    variantId: 'standard',
    timeControlId,
    color: 'w' as const,
    name: 'takma',
    rated,
  });

  it('yalnızca iki hesap, saatli oyun ve istenmişse puanlı; hesap adı takma adın yerine geçer', () => {
    const both = joinRoom(createRoom('Abcd1234', req(true), 't1', () => 0, ada).room, 'x', 't2', bora).room;
    expect(both.rated).toBe(true);
    expect(both.seats.w?.name).toBe('Ada');
    expect(both.seats.b?.account).toEqual(bora);
    expect(joinRoom(createRoom('Abcd1234', req(true), 't1', () => 0, ada).room, 'misafir', 't2').room.rated).toBe(
      false,
    );
    expect(joinRoom(createRoom('Abcd1234', req(false), 't1', () => 0, ada).room, 'x', 't2', bora).room.rated).toBe(
      false,
    );
    expect(
      joinRoom(createRoom('Abcd1234', req(true, 'none'), 't1', () => 0, ada).room, 'x', 't2', bora).room.rated,
    ).toBe(false);
    expect(joinRoom(createRoom('Abcd1234', req(true), 't1', () => 0, ada).room, 'x', 't2', ada).room.rated).toBe(false);
  });

  it('rövanş hesapları ve puanlı oluşu korur', () => {
    let room = joinRoom(createRoom('Abcd1234', req(true), 't1', () => 0, ada).room, 'x', 't2', bora).room;
    room = resign(room, 'w', 10);
    room = rematch(room, 'w', 'offer', 'Efgh5678').room;
    const next = rematch(room, 'b', 'accept', 'Efgh5678').next!;
    expect(next.rated).toBe(true);
    expect(next.seats.w?.account).toEqual(bora);
    expect(next.seats.b?.account).toEqual(ada);
  });
});
describe('gecikme telafisi', () => {
  it('bildirilen gecikme saate geri eklenir, hamle başı en çok LAG.perMove ve hamlenin kendi süresinden fazla değil', () => {
    let room = newGame(); // 5+0
    room = playMove(room, 'w', mv('e2', 'e4'), 0, 1000); // first move: White's clock does not run yet
    room = playMove(room, 'b', mv('e7', 'e5'), 1, 3000, 300); // Black thought 2000 ms, 300 ms of it network
    expect(room.clock.remaining.b).toBe(300_000 - 2000 + 300);
    room = playMove(room, 'w', mv('g1', 'f3'), 2, 4000, 5000); // claims 5 s of lag: capped
    expect(room.clock.remaining.w).toBe(300_000 - 1000 + 500);
    room = playMove(room, 'b', mv('b8', 'c6'), 3, 4100, 400); // only 100 ms passed: at most that comes back
    expect(room.clock.remaining.b).toBe(300_000 - 2000 + 300);
  });

  it('telafi bir hesaptan ödenir: sürekli yüksek gecikme bildiren hamle başına en çok LAG.refill kazanır', async () => {
    const { LAG } = await import('../src/online/room.ts');
    let room = newGame();
    const plies = [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['g8', 'f6'],
      ['b1', 'c3'],
      ['f8', 'c5'],
      ['d2', 'd3'],
      ['d7', 'd6'],
      ['c1', 'g5'],
      ['c8', 'g4'],
      ['h2', 'h3'],
      ['g4', 'h5'],
      ['a2', 'a3'],
      ['a7', 'a6'],
      ['b2', 'b4'],
      ['c5', 'a7'],
      ['a1', 'b1'],
      ['h7', 'h6'],
      ['g5', 'h4'],
      ['h8', 'h7'],
      ['b1', 'a1'],
      ['h7', 'h8'],
    ] as const;
    let now = 1000;
    for (let i = 0; i < plies.length; i++) {
      now += 1000;
      room = playMove(room, i % 2 ? 'b' : 'w', mv(plies[i][0], plies[i][1]), i, now, 500);
    }
    // White moved 12 times, the first without a clock: 11 seconds used.
    const credited = room.clock.remaining.w - (300_000 - 11_000);
    expect(credited).toBeLessThanOrEqual(LAG.bank + 11 * LAG.refill);
    expect(credited).toBeLessThan(11 * 500);
    expect(gameOf(room)?.moves.length).toBe(plies.length);
  });
});
