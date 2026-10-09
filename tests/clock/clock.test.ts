import { describe, expect, it } from 'vitest';
import {
  TIME_CONTROLS,
  createClock,
  flagged,
  formatClock,
  pressClock,
  remainingMs,
  stopClock,
  timeControl,
  timeoutWinner,
} from '../../src/clock/clock.ts';
import { parseFen } from '../../src/engine/notation.ts';
import { getVariant } from '../../src/engine/variants/index.ts';

const MIN = 60_000;

describe('saat', () => {
  it('süre seçenekleri: Süresiz, 1+0, 3+2, 5+0, 10+0, 15+10', () => {
    expect(TIME_CONTROLS.map((t) => t.label)).toEqual(['Süresiz', '1+0', '3+2', '5+0', '10+0', '15+10']);
    expect(timeControl('3+2')).toMatchObject({ initialMs: 3 * MIN, incrementMs: 2000 });
  });

  it('ilk hamleden önce saat işlemez; beyazın ilk hamlesi süresinden düşmez', () => {
    let c = createClock(timeControl('1+0'));
    expect(remainingMs(c, 'w', 50_000)).toBe(MIN);
    expect(flagged(c, 10 * MIN)).toBeNull();
    c = pressClock(c, 'w', 50_000); // beyaz 50 sn düşündü: düşmez
    expect(remainingMs(c, 'w', 50_000)).toBe(MIN);
    expect(c.running).toBe('b');
    expect(remainingMs(c, 'b', 60_000)).toBe(MIN - 10_000);
  });

  it('hamle yapanın saati durur, artış eklenir, rakibinki başlar', () => {
    let c = createClock(timeControl('3+2'));
    c = pressClock(c, 'w', 0);
    c = pressClock(c, 'b', 5_000); // siyah 5 sn kullandı, +2 sn
    expect(remainingMs(c, 'b', 99_000)).toBe(3 * MIN - 5_000 + 2_000);
    expect(c.running).toBe('w');
    c = pressClock(c, 'w', 8_000); // beyaz 3 sn kullandı, +2 sn
    expect(remainingMs(c, 'w', 8_000)).toBe(3 * MIN - 3_000 + 2_000);
    expect(remainingMs(c, 'b', 9_000)).toBe(3 * MIN - 3_000 - 1_000);
  });

  it('süre bitince doğru taraf düşer', () => {
    let c = createClock(timeControl('1+0'));
    c = pressClock(c, 'w', 0);
    expect(flagged(c, 59_999)).toBeNull();
    expect(flagged(c, 60_000)).toBe('b');
    c = pressClock(c, 'b', 30_000);
    expect(flagged(c, 30_000 + 60_000)).toBe('w');
  });

  it('süre biterse rakip kazanır; rakipte mat gücü yoksa beraberlik', () => {
    const v = getVariant('standard');
    // Siyahın süresi bitti; beyazda vezir var: beyaz kazanır.
    expect(timeoutWinner(v, parseFen(v, '4k3/8/8/8/8/8/8/3QK3 w - - 0 1'), 'b')).toBe('w');
    // Beyazda yalnız şah + at; siyahın kalesi olsa da beyaz mat edemez: beraberlik.
    expect(timeoutWinner(v, parseFen(v, '4k3/8/8/8/8/8/r7/3NK3 w - - 0 1'), 'b')).toBeNull();
    // Beyazın süresi bitti, siyahta kale var: siyah kazanır.
    expect(timeoutWinner(v, parseFen(v, '4k3/8/8/8/8/8/r7/3NK3 w - - 0 1'), 'w')).toBe('b');
    // Bürokrat mat gücü sayılmaz.
    const bur = getVariant('burokrat');
    expect(timeoutWinner(bur, parseFen(bur, '4k3/8/8/8/8/8/8/3UK3 w - - 0 1'), 'b')).toBeNull();
  });

  it('oyun bitince saatler durur', () => {
    let c = createClock(timeControl('5+0'));
    c = pressClock(c, 'w', 0);
    c = stopClock(c, 10_000);
    expect(remainingMs(c, 'b', 99 * MIN)).toBe(5 * MIN - 10_000);
    expect(flagged(c, 99 * MIN)).toBeNull();
    expect(pressClock(c, 'b', 99 * MIN)).toBe(c);
  });

  it('süresiz oyunda saat hiç işlemez', () => {
    let c = createClock(timeControl('none'));
    c = pressClock(c, 'w', 0);
    expect(c.running).toBeNull();
    expect(flagged(c, 10 ** 9)).toBeNull();
    expect(formatClock(remainingMs(c, 'w', 0))).toBe('∞');
  });

  it('gösterim: m:ss, son 10 saniyede ondalıklı', () => {
    expect(formatClock(3 * MIN)).toBe('3:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(10_000)).toBe('0:10');
    expect(formatClock(9_950)).toBe('9.9');
    expect(formatClock(0)).toBe('0.0');
  });
});
