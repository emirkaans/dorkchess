import { describe, expect, it } from 'vitest';
import { limitKind, overLimit } from '../server/limits.ts';
import type { RateLimiter } from '../server/limits.ts';
import { offensiveName } from '../src/online/badwords.ts';
import { usernameProblem } from '../src/online/account.ts';

describe('istek sınırları', () => {
  it('oyun kurma, yazma ve veritabanı okuyan istekler ayrı sayılır; sayfalar ve dosyalar sayılmaz', () => {
    expect(limitKind('POST', '/api/games')).toBe('create');
    expect(limitKind('POST', '/api/games/AbCd1234/join')).toBe('create');
    expect(limitKind('POST', '/api/puzzles/abcde/result')).toBe('write');
    expect(limitKind('POST', '/api/auth/logout')).toBe('write');
    expect(limitKind('GET', '/api/puzzles/next')).toBe('read');
    expect(limitKind('GET', '/api/games/AbCd1234/ws')).toBe('read');
    expect(limitKind('GET', '/api/users/AdaPunk/games')).toBe('read');
    expect(limitKind('GET', '/')).toBeNull();
    expect(limitKind('GET', '/assets/index.js')).toBeNull();
    expect(limitKind('GET', '/api/me')).toBeNull();
  });

  it('sınırı aşan istek 429 alır; bağlantı yoksa sınır yok', async () => {
    const req = new Request('https://x/api/games', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4' } });
    let key = '';
    const no = { limit: async (o: { key: string }) => ((key = o.key), { success: false }) } as RateLimiter;
    const res = await overLimit(req, { CREATE_LIMIT: no }, '/api/games');
    expect(res?.status).toBe(429);
    expect(key).toBe('create:1.2.3.4');
    expect(await overLimit(req, {}, '/api/games')).toBeNull();
  });
});

describe('kullanıcı adı filtresi', () => {
  it('küfür ve hakaret içeren adlar alınamaz, rakamla yazılsa da', () => {
    for (const bad of ['orospu_cocugu', 'Or0spu', 'Sik-tir', 'xXfuckXx', 'amk', 'Hitler88']) {
      expect(offensiveName(bad), bad).toBe(true);
      expect(usernameProblem(bad), bad).toBe('reserved');
    }
  });

  it('içinde kısa bir kelime geçen sıradan adlar serbest', () => {
    for (const ok of ['Stamina', 'Ocean', 'Gotham', 'Picasso', 'Dickens', 'Sikander', 'AdaPunk', 'Essex']) {
      expect(offensiveName(ok), ok).toBe(false);
    }
  });
});
