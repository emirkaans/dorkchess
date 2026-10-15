// Request limits per visitor (Cloudflare's rate limiting binding, counted per
// IP address and per Cloudflare location): enough for anyone playing, not
// enough to flood the database or the game rooms. The limits themselves are
// in wrangler.jsonc ("ratelimits").

/** Which limit a request counts toward (null: none). */
export type LimitKind = 'create' | 'write' | 'read';

/** A rate limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The bindings; missing ones (tests, an older config) limit nothing. */
export interface LimitEnv {
  readonly CREATE_LIMIT?: RateLimiter;
  readonly WRITE_LIMIT?: RateLimiter;
  readonly READ_LIMIT?: RateLimiter;
}

/** GET requests that read the database or open a connection (static files and pages are free). */
const LIMITED_READS = [
  /^\/api\/puzzles\/next$/,
  /^\/api\/rush$/,
  /^\/api\/daily$/,
  /^\/api\/challenges$/,
  /^\/api\/leaderboard$/,
  /^\/api\/users\//,
  /^\/api\/auth\/username$/,
  /^\/api\/lobby\/ws$/,
  /^\/api\/games\/[^/]+\/ws$/,
  /^\/auth\/google\/start$/,
];

export function limitKind(method: string, path: string): LimitKind | null {
  if (method === 'POST' && (path === '/api/games' || /^\/api\/games\/[^/]+\/join$/.test(path))) return 'create';
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    method !== 'OPTIONS' &&
    (path.startsWith('/api/') || path.startsWith('/auth/'))
  )
    return 'write';
  if (method === 'GET' && LIMITED_READS.some((r) => r.test(path))) return 'read';
  return null;
}

/** A 429 when this request is over its limit, otherwise null. */
export async function overLimit(request: Request, env: LimitEnv, path: string): Promise<Response | null> {
  const kind = limitKind(request.method, path);
  if (!kind) return null;
  const limiter = { create: env.CREATE_LIMIT, write: env.WRITE_LIMIT, read: env.READ_LIMIT }[kind];
  if (!limiter) return null;
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const { success } = await limiter.limit({ key: `${kind}:${ip}` });
  if (success) return null;
  return new Response(JSON.stringify({ error: 'rate-limited' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '60', 'cache-control': 'no-store' },
  });
}
