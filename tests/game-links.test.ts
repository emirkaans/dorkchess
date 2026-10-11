// Game links: page addresses and the game records stored on the server.

import { describe, expect, it } from 'vitest';
import { parseSquare } from '../src/engine/board.ts';
import { createRoom, joinRoom, playMove } from '../src/online/room.ts';
import { isGameId, randomGameId, recordOfRoom, statesOfRecord, validateRecord } from '../src/online/record.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('adresler', () => {
  it('sayfalar ve oyunlar kendi yollarında; yol ile adres birbirine döner', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/analysis')).toEqual({ kind: 'analysis' });
    expect(parseRoute('/online/')).toEqual({ kind: 'online' });
    expect(parseRoute('/Ab3dEf7h')).toEqual({ kind: 'game', id: 'Ab3dEf7h' });
    expect(parseRoute('/Ab3dEf7h/analysis')).toEqual({ kind: 'review', id: 'Ab3dEf7h' });
    expect(parseRoute('/mv3o94jt-bbqz/analysis')).toEqual({ kind: 'review', id: 'mv3o94jt-bbqz' }); // older history ids
    expect(parseRoute('/assets/x.js')).toEqual({ kind: 'home' });
    for (const r of [
      { kind: 'analysis' },
      { kind: 'game', id: 'Ab3dEf7h' },
      { kind: 'review', id: 'Ab3dEf7h' },
    ] as const)
      expect(parseRoute(pathOf(r))).toEqual(r);
  });

  it('yeni oyun numaraları 8 harf/rakam', () => {
    const id = randomGameId();
    expect(isGameId(id)).toBe(true);
    expect(randomGameId()).not.toBe(id);
  });
});

describe('sunucudaki oyun kaydı', () => {
  const record = {
    variantId: 'standard',
    startFen: '',
    moves: ['e4', 'e5', 'Nf3'],
    white: 'human',
    black: 'bot:3',
    mode: 'bot',
    timeControlId: '5+0',
    result: '*',
    termination: '',
    date: '2026-10-11T10:00:00.000Z',
  };

  it('geçerli kayıt temizlenir ve oyun yeniden kurulur; yasadışı hamle ya da bilinmeyen varyant reddedilir', () => {
    const clean = validateRecord(record)!;
    expect(clean.startFen).toMatch(/^rnbqkbnr/);
    expect(
      statesOfRecord(clean)
        .at(-1)!
        .moves.map((m) => m.san),
    ).toEqual(['e4', 'e5', 'Nf3']);
    expect(validateRecord({ ...record, moves: ['e4', 'Ke7', 'Ke2', 'Kd6', 'Kd3', 'Kc5', 'Kc3', 'Qa1'] })).toBeNull();
    expect(validateRecord({ ...record, variantId: 'nope' })).toBeNull();
    expect(validateRecord({ ...record, result: 'win!' })?.result).toBe('*');
    expect(validateRecord(null)).toBeNull();
  });

  it('online oyunun kaydı odadan çıkarılır', () => {
    const created = createRoom(
      'Abcd1234',
      { variantId: 'standard', timeControlId: '5+0', color: 'w', name: 'Ayşe' },
      't1',
      () => 0,
    );
    let room = joinRoom(created.room, 'Bora', 't2').room;
    room = playMove(room, 'w', { from: parseSquare('e2'), to: parseSquare('e4') }, 0, 0);
    const r = recordOfRoom(room)!;
    expect(r).toMatchObject({ white: 'Ayşe', black: 'Bora', mode: 'online', moves: ['e4'], result: '*' });
  });
});
