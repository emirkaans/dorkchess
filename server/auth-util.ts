// Small helpers of the sign-in code (server/auth.ts) that need no Workers types,
// so they can be tested in Node.

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${opts.maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
export const sha256hex = async (text: string) =>
  Array.from(await sha256(text), (b) => b.toString(16).padStart(2, '0')).join('');

/** Only paths on this site are followed after signing in. */
export const safeReturn = (path: string | null): string =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/auth/') ? path : '/';

/** The claims of a Google ID token we use, or null when it is not for us or expired. */
export function idTokenClaims(
  idToken: string,
  clientId: string,
  nowSeconds: number,
): { sub: string; email: string | null; name: string | null } | null {
  try {
    const payload = idToken.split('.')[1];
    const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0)))) as Record<
      string,
      unknown
    >;
    const issOk = json.iss === 'https://accounts.google.com' || json.iss === 'accounts.google.com';
    if (!issOk || json.aud !== clientId || typeof json.exp !== 'number' || json.exp < nowSeconds) return null;
    if (typeof json.sub !== 'string' || !json.sub) return null;
    return {
      sub: json.sub,
      email: typeof json.email === 'string' && json.email_verified !== false ? json.email : null,
      name: typeof json.name === 'string' ? json.name : null,
    };
  } catch {
    return null;
  }
}
