// Accounts: username rules (shared) and the Worker's sign-in helpers (server/auth.ts).

import { describe, expect, it } from 'vitest';
import { suggestUsername, usernameProblem } from '../src/online/account.ts';
import { cookie, idTokenClaims, parseCookies, safeReturn } from '../server/auth-util.ts';

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

describe('hesaplar', () => {
  it('kullanıcı adı kuralları', () => {
    expect(usernameProblem('punk_kid-7')).toBeNull();
    expect(usernameProblem('ab')).toBe('length');
    expect(usernameProblem('a'.repeat(21))).toBe('length');
    expect(usernameProblem('kötü')).toBe('chars');
    expect(usernameProblem('a b')).toBe('chars');
    expect(usernameProblem('7punk')).toBe('start');
    expect(usernameProblem('Admin')).toBe('reserved');
  });

  it('önerilen ad Google adından türetilir, kurala uymuyorsa boş kalır', () => {
    expect(suggestUsername('Emir Kaan Sarıçam')).toBe('EmirKaanSaricam');
    expect(suggestUsername('Çağrı Öz')).toBe('CagriOz');
    expect(suggestUsername('42')).toBe('');
    expect(suggestUsername(null)).toBe('');
  });

  it('çerezler okunur ve güvenli yazılır', () => {
    expect(parseCookies('a=1; pc_session=x%20y; b')).toEqual({ a: '1', pc_session: 'x y' });
    const c = cookie('pc_session', 'tok', { maxAge: 60, secure: true });
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
    expect(cookie('x', '', { maxAge: 0, secure: false })).not.toContain('Secure');
  });

  it('girişten sonra yalnızca sitenin kendi sayfalarına dönülür', () => {
    expect(safeReturn('/online')).toBe('/online');
    expect(safeReturn('//evil.example')).toBe('/');
    expect(safeReturn('https://evil.example')).toBe('/');
    expect(safeReturn('/auth/google/start')).toBe('/');
    expect(safeReturn(null)).toBe('/');
  });

  it('Google kimlik belirteci: yalnızca bizim istemcimize verilmiş ve süresi geçmemiş olan kabul edilir', () => {
    const ok = {
      iss: 'https://accounts.google.com',
      aud: 'client',
      exp: 2000,
      sub: '123',
      email: 'a@b.c',
      name: 'Ada',
    };
    expect(idTokenClaims(token(ok), 'client', 1000)).toEqual({ sub: '123', email: 'a@b.c', name: 'Ada' });
    expect(idTokenClaims(token({ ...ok, aud: 'other' }), 'client', 1000)).toBeNull();
    expect(idTokenClaims(token({ ...ok, iss: 'https://evil.example' }), 'client', 1000)).toBeNull();
    expect(idTokenClaims(token(ok), 'client', 3000)).toBeNull();
    expect(idTokenClaims(token({ ...ok, email_verified: false }), 'client', 1000)?.email).toBeNull();
    expect(idTokenClaims('garbage', 'client', 1000)).toBeNull();
  });
});
