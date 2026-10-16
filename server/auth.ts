// Accounts: sign in with Google, sessions in a cookie, the username picked at
// the first sign-in. Data in D1 (migrations/). How a player signs in lives in
// the `identities` table, so other ways can be added next to Google.
//
//   GET  /auth/google/start?return=/path   to Google's sign-in page
//   GET  /auth/google/callback             back from Google: signs in, or asks for a username
//   GET  /api/me                           { user, signup }
//   GET  /api/auth/username?name=…         { ok } or { problem }
//   POST /api/auth/username { username }   creates the account (after a Google sign-in)
//   POST /api/auth/logout
//   POST /api/auth/delete                  deletes the signed-in account (and its sign-in link, sessions)

import { suggestUsername, usernameProblem } from '../src/online/account.ts';
import { isStaffRole } from '../src/online/admin.ts';
import { tagById } from '../src/achievements/tags.ts';
import type { AccountUser, MeResponse, UsernameProblem } from '../src/online/account.ts';
import {
  base64url,
  cookie,
  idTokenClaims,
  parseCookies,
  randomToken,
  safeReturn,
  sha256,
  sha256hex,
} from './auth-util.ts';

export interface AuthEnv {
  readonly DB: D1Database;
  /** OAuth client of the Google Cloud project (public). Empty: sign-in is off. */
  readonly GOOGLE_CLIENT_ID?: string;
  /** Its secret (set with `wrangler secret put GOOGLE_CLIENT_SECRET`, or .dev.vars locally). */
  readonly GOOGLE_CLIENT_SECRET?: string;
  /** The site's address when the request's own is not it (local development; see .dev.vars). */
  readonly PUBLIC_ORIGIN?: string;
  /**
   * Emergency stop: "1" turns the API and live games off (the site itself still
   * loads). Set it in the Cloudflare dashboard (Worker → Settings → Variables)
   * if something runs away; remove it to turn everything back on.
   */
  readonly PAUSE_API?: string;
}

const SESSION_COOKIE = 'pc_session';
const SIGNUP_COOKIE = 'pc_signup';
const OAUTH_COOKIE = 'pc_oauth';
const SESSION_DAYS = 60;
const SIGNUP_MINUTES = 30;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ location: to });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
};

/** POSTs must come from this site's own pages. */
/** POSTs must come from this site's own pages (its public address, or the address the request came to). */
export const sameOrigin = (request: Request, origin: string, url?: URL) => {
  const from = request.headers.get('origin');
  return from === origin || (!!url && from === url.origin);
};

// ---------------------------------------------------------------------------
// Sessions

/** The signed-in user of a request, or null. */
export async function currentUser(request: Request, env: AuthEnv): Promise<AccountUser | null> {
  if (!env.DB) return null;
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.rating, u.role, u.tag FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND s.expires_at > ?2 AND u.banned_at IS NULL`,
  )
    .bind(await sha256hex(token), Date.now())
    .first<{ id: string; username: string; rating: number | null; role: string | null; tag: string | null }>();
  if (!row) return null;
  const role = isStaffRole(row.role) ? row.role : null;
  return {
    id: row.id,
    username: row.username,
    rating: row.rating,
    tag: tagById(row.tag).id,
    ...(role ? { role } : {}),
  };
}

async function newSession(env: AuthEnv, userId: string, secure: boolean): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256hex(token), userId, now, now + SESSION_DAYS * 86_400_000)
    .run();
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400, secure });
}

async function pendingSignup(request: Request, env: AuthEnv) {
  const id = parseCookies(request.headers.get('cookie'))[SIGNUP_COOKIE];
  if (!id) return null;
  return env.DB.prepare('SELECT * FROM signups WHERE id = ?1 AND expires_at > ?2')
    .bind(id, Date.now())
    .first<{ id: string; provider: string; subject: string; email: string | null; suggested: string | null }>();
}

// ---------------------------------------------------------------------------
// Routes

/** Answers an account request, or returns null when `url` is not one. */
export async function handleAuth(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  // The address players use. Locally `wrangler dev` reports the production domain (from the
  // routes), so .dev.vars sets PUBLIC_ORIGIN=http://localhost:5173 there.
  const origin = env.PUBLIC_ORIGIN || url.origin;
  const secure = origin.startsWith('https:');
  const isAuthRoute = path.startsWith('/auth/') || path === '/api/me' || path.startsWith('/api/auth/');
  if (!isAuthRoute) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);

  if (path === '/api/me' && request.method === 'GET') {
    const user = await currentUser(request, env);
    const signup = user ? null : await pendingSignup(request, env);
    const providers = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? (['google'] as const) : [];
    return json(
      { user, signup: signup ? { suggested: signup.suggested ?? '' } : null, providers } satisfies MeResponse,
      200,
      {
        'cache-control': 'no-store',
      },
    );
  }

  if (path === '/auth/google/start' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'google-off' }, 503);
    const state = randomToken(16);
    const verifier = randomToken(32);
    const challenge = base64url(await sha256(verifier));
    const back = safeReturn(url.searchParams.get('return'));
    const target = new URL(GOOGLE_AUTH);
    target.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return redirect(target.toString(), [
      cookie(OAUTH_COOKIE, JSON.stringify({ state, verifier, back }), { maxAge: 600, secure, path: '/auth/' }),
    ]);
  }

  if (path === '/auth/google/callback' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'google-off' }, 503);
    const clearOauth = cookie(OAUTH_COOKIE, '', { maxAge: 0, secure, path: '/auth/' });
    let saved: { state: string; verifier: string; back: string };
    try {
      saved = JSON.parse(parseCookies(request.headers.get('cookie'))[OAUTH_COOKIE] ?? '') as typeof saved;
    } catch {
      return redirect('/?signin=failed', [clearOauth]);
    }
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== saved.state) return redirect('/?signin=failed', [clearOauth]);

    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string };
    // The token comes straight from Google over TLS, so its claims are read without re-checking the signature.
    const claims =
      res.ok && tokens.id_token ? idTokenClaims(tokens.id_token, env.GOOGLE_CLIENT_ID, Date.now() / 1000) : null;
    if (!claims) return redirect('/?signin=failed', [clearOauth]);

    const known = await env.DB.prepare(
      `SELECT i.user_id, u.banned_at FROM identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = ?1 AND i.subject = ?2`,
    )
      .bind('google', claims.sub)
      .first<{ user_id: string; banned_at: number | null }>();
    // A banned account does not sign in (and cannot make a new one with the same Google account).
    if (known?.banned_at) return redirect('/?signin=banned', [clearOauth]);
    if (known) return redirect(saved.back, [clearOauth, await newSession(env, known.user_id, secure)]);

    // First sign-in: remember who this is until a username is picked.
    const id = randomToken(16);
    await env.DB.prepare(
      'INSERT INTO signups (id, provider, subject, email, suggested, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(id, 'google', claims.sub, claims.email, suggestUsername(claims.name), Date.now() + SIGNUP_MINUTES * 60_000)
      .run();
    return redirect(`/signup?return=${encodeURIComponent(saved.back)}`, [
      clearOauth,
      cookie(SIGNUP_COOKIE, id, { maxAge: SIGNUP_MINUTES * 60, secure }),
    ]);
  }

  if (path === '/api/auth/username' && request.method === 'GET') {
    const name = url.searchParams.get('name') ?? '';
    const problem = usernameProblem(name) ?? ((await usernameTaken(env, name)) ? 'taken' : null);
    return json(problem ? { problem } : { ok: true });
  }

  if (path === '/api/auth/username' && request.method === 'POST') {
    if (!sameOrigin(request, origin, url)) return json({ error: 'forbidden' }, 403);
    const signup = await pendingSignup(request, env);
    if (!signup) return json({ error: 'no-signup' }, 400);
    const body = (await request.json().catch(() => ({}))) as { username?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    let problem: UsernameProblem | null = usernameProblem(username);
    if (!problem && (await usernameTaken(env, username))) problem = 'taken';
    if (problem) return json({ problem }, 400);

    const userId = crypto.randomUUID();
    const now = Date.now();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, username, created_at) VALUES (?1, ?2, ?3)').bind(userId, username, now),
        env.DB.prepare(
          'INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        ).bind(signup.provider, signup.subject, userId, signup.email, now),
        env.DB.prepare('DELETE FROM signups WHERE id = ?1').bind(signup.id),
      ]);
    } catch {
      // Someone took the name a moment ago (or this Google account got an account meanwhile).
      return json({ problem: 'taken' satisfies UsernameProblem }, 400);
    }
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', await newSession(env, userId, secure));
    headers.append('set-cookie', cookie(SIGNUP_COOKIE, '', { maxAge: 0, secure }));
    return new Response(JSON.stringify({ user: { id: userId, username, rating: null } satisfies AccountUser }), {
      headers,
    });
  }

  if (path === '/api/auth/delete' && request.method === 'POST') {
    if (!sameOrigin(request, origin, url)) return json({ error: 'forbidden' }, 403);
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'signed-out' }, 401);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM ratings WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM user_patches WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM puzzle_attempts WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM daily_results WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM rush_scores WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM challenges WHERE from_user = ?1 OR to_user = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM follows WHERE follower = ?1 OR followee = ?1').bind(user.id),
      // Gangs: out of one's gang; a gang one founded passes to its longest-standing member, or closes when empty.
      env.DB.prepare('DELETE FROM gang_members WHERE user_id = ?1').bind(user.id),
      env.DB.prepare(
        'DELETE FROM gangs WHERE owner = ?1 AND NOT EXISTS (SELECT 1 FROM gang_members m WHERE m.gang_id = gangs.id)',
      ).bind(user.id),
      env.DB.prepare(
        `UPDATE gangs SET owner = (SELECT m.user_id FROM gang_members m WHERE m.gang_id = gangs.id ORDER BY m.joined_at LIMIT 1)
         WHERE owner = ?1`,
      ).bind(user.id),
      // Played games stay (they are the opponent's too), no longer tied to the account.
      env.DB.prepare('UPDATE games SET white_user = NULL WHERE white_user = ?1').bind(user.id),
      env.DB.prepare('UPDATE games SET black_user = NULL WHERE black_user = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM identities WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(user.id),
    ]);
    return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure }) });
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    if (!sameOrigin(request, origin, url)) return json({ error: 'forbidden' }, 403);
    const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
    if (token)
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?1')
        .bind(await sha256hex(token))
        .run();
    return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure }) });
  }

  return json({ error: 'not-found' }, 404);
}

export async function usernameTaken(env: AuthEnv, name: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?1').bind(name).first();
  return row !== null;
}
