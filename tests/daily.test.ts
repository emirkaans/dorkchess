import { describe, expect, it } from 'vitest';
import {
  dailyDay,
  dailyNumber,
  dailyShareText,
  dayHash,
  gridEmoji,
  gridSolved,
  isDailyGrid,
  nextDailyAt,
  previousDay,
  streakOf,
} from '../src/online/daily.ts';
import { parseRoute, pathOf } from '../src/ui/routes.ts';

describe('günün sabotajı', () => {
  it('gün Türkiye saatiyle gece yarısı döner', () => {
    expect(dailyDay(Date.parse('2026-10-12T20:59:59Z'))).toBe('2026-10-12');
    expect(dailyDay(Date.parse('2026-10-12T21:00:00Z'))).toBe('2026-10-13');
    expect(nextDailyAt(Date.parse('2026-10-12T10:00:00Z'))).toBe(Date.parse('2026-10-12T21:00:00Z'));
    expect(nextDailyAt(Date.parse('2026-10-12T22:00:00Z'))).toBe(Date.parse('2026-10-13T21:00:00Z'));
  });

  it('numara ilk günden sayılır', () => {
    expect(dailyNumber('2026-10-12')).toBe(1);
    expect(dailyNumber('2026-10-13')).toBe(2);
    expect(dailyNumber('2027-10-12')).toBe(366);
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });

  it('seri: üst üste çözülen günler; bugün oynanmadıysa dünden sayılır', () => {
    const days = ['2026-10-10', '2026-10-11', '2026-10-12'];
    expect(streakOf(days, '2026-10-12')).toBe(3);
    expect(streakOf(days, '2026-10-13')).toBe(3);
    expect(streakOf(days, '2026-10-14')).toBe(0);
    expect(streakOf(['2026-10-09', '2026-10-11', '2026-10-12'], '2026-10-12')).toBe(2);
    expect(streakOf([], '2026-10-12')).toBe(0);
  });

  it('kareler ve paylaşma metni', () => {
    expect(isDailyGrid('hmh')).toBe(true);
    expect(isDailyGrid('')).toBe(false);
    expect(isDailyGrid('hx')).toBe(false);
    expect(gridSolved('hmh')).toBe(true);
    expect(gridSolved('hs')).toBe(false);
    expect(gridEmoji('hms')).toBe('🟩🟥⬛');
    expect(dailyShareText(4, 'hm', 3, 'https://punkchess.com/daily')).toBe(
      'punkchess #4 🟩🟥 🔥3\nhttps://punkchess.com/daily',
    );
    expect(dailyShareText(4, 'h', 1, 'u')).toBe('punkchess #4 🟩\nu');
  });

  it('günün bulmacası günden seçilir (her gün farklı)', () => {
    expect(dayHash('2026-10-12')).toBe(dayHash('2026-10-12'));
    expect(dayHash('2026-10-12')).not.toBe(dayHash('2026-10-13'));
  });

  it('adres: /daily', () => {
    expect(parseRoute('/daily')).toEqual({ kind: 'daily' });
    expect(pathOf({ kind: 'daily' })).toBe('/daily');
  });
});
