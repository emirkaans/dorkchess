// Online game rules (src/online/room.ts): seats, setup, moves, clock, draws,
// resignation and the 15-second reconnect rule. Pure functions, fake time.

import { describe, expect, it } from 'vitest';
import { parseSquare } from '../src/engine/board.ts';
import { RECONNECT_MS } from '../src/online/protocol.ts';
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

  it('kopma: 15 saniye içinde dönmeyen kaybeder, saat bu arada işler; dönerse sayaç iptal', () => {
    let room = playMove(newGame(), 'w', mv('e2', 'e4'), 0, 0);
    room = setConnected(room, 'b', false, 1000);
    expect(nextDeadline(room)).toBe(1000 + RECONNECT_MS);
    const view = viewOf(room, 'w', { w: true, b: false }, 2000);
    expect(view.players.b).toEqual({ name: 'Bora', connected: false, deadline: 1000 + RECONNECT_MS });
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
});
