import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE, MAX_STACK, cleanReport } from '../src/online/errors.ts';
import { limitKind } from '../server/limits.ts';

describe('hata bildirimleri', () => {
  it('rapor kırpılır; adresin sorgu ve # kısmı atılır', () => {
    const r = cleanReport({
      message: 'x'.repeat(1000),
      stack: 's'.repeat(5000),
      path: '/abcdEFGH?token=secret#frag',
      userAgent: 'UA',
      build: 'index-1.js',
    });
    expect(r?.message.length).toBe(MAX_MESSAGE);
    expect(r?.stack.length).toBe(MAX_STACK);
    expect(r?.path).toBe('/abcdEFGH');
  });

  it('mesajı olmayan ya da bozuk gövde rapor sayılmaz', () => {
    expect(cleanReport(null)).toBeNull();
    expect(cleanReport({ message: '' })).toBeNull();
    expect(cleanReport('boom')).toBeNull();
  });

  it('rapor göndermek yazma sınırına tabi', () => {
    expect(limitKind('POST', '/api/errors')).toBe('write');
  });
});
