// Cloudflare Worker for punkchess.com: serves the built site (static assets)
// and the online game API. Each game lives in its own Durable Object.
//
//   POST /api/games               create a game -> { gameId, color, token }
//   POST /api/games/:id/join      take the free seat -> { gameId, color, token }
//   GET  /api/games/:id/ws        WebSocket (first message: { t: 'hello', token })
//   GET  /api/games/:id           what the game link shows (online room or stored local game)
//   GET  /api/lobby/ws            WebSocket to the lobby (open seeks, quick pairing)
//   /auth/*, /api/me, /api/auth/*  accounts (server/auth.ts)
//   /api/users/:username[/games|/history]  public profiles (server/profiles.ts)
//   /api/puzzles/next, /api/puzzles/:id[/result]  puzzles (server/puzzles.ts)
//   PUT  /api/games/:id/record    stores a local game (bot / two players) so its link works anywhere
//   GET  /og/:id.png              link-preview picture of a game
// Game pages (/<id>, /<id>/analysis) get link-preview tags for that game.

import { GAME_ID } from '../src/online/protocol.ts';
import type { Env } from './game-room.ts';
import type { GameInfo } from '../src/online/record.ts';
import { previewTags, previewVersion } from './og.ts';
import { currentUser, handleAuth } from './auth.ts';
import { handleProfiles } from './profiles.ts';
import { handleDaily } from './daily.ts';
import { handleLeaderboard } from './leaderboard.ts';
import { handleRush } from './rush.ts';
import { handleChallenges } from './challenges.ts';
import { handleErrors } from './errors.ts';
import { handleFollows } from './follows.ts';
import { handleGangs } from './gangs.ts';
import { pagePreview, sitemap } from './pages.ts';
import { overLimit } from './limits.ts';
import { handlePuzzles } from './puzzles.ts';

export { GameRoom } from './game-room.ts';
export { Lobby } from './lobby.ts';
import { withAccountHeaders } from './account-headers.ts';

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function newGameId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

const notFound = () =>
  new Response(JSON.stringify({ error: 'not-found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

/** Forwards a request to the game's Durable Object as `path` (the id goes along as a parameter). */
function toRoom(env: Env, request: Request, id: string, path: string): Promise<Response> {
  const stub = env.GAME.get(env.GAME.idFromName(id));
  const url = new URL(request.url);
  url.pathname = path;
  url.search = `?id=${id}`;
  return stub.fetch(new Request(url, request));
}

/**
 * A game address: the app page, with the link-preview tags of that game
 * (so a link shared in a chat shows the board, the players and the result).
 */
async function gamePage(env: Env, request: Request, url: URL, id: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  let info: GameInfo | null = null;
  try {
    const res = await toRoom(env, new Request(new URL(`/api/games/${id}`, url)), id, '/info');
    if (res.ok) info = (await res.json()) as GameInfo;
  } catch {
    // no preview: the page itself still works
  }
  const record = info?.record;
  if (!record || !page.headers.get('content-type')?.includes('text/html')) return page;
  const image = `${url.origin}/og/${id}.png?v=${previewVersion(record)}`;
  const tags = previewTags(record, `${url.origin}${url.pathname}`, image);
  return new HTMLRewriter()
    .on('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]', {
      element: (el) => {
        el.remove();
      },
    })
    .on('head', {
      element: (el) => {
        el.append(tags, { html: true });
      },
    })
    .transform(page);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www.punkchess.com -> punkchess.com
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    // Emergency stop (see AuthEnv.PAUSE_API): no API, no game rooms, no database.
    const paused = env.PAUSE_API === '1';
    if (
      paused &&
      (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/og/'))
    ) {
      return new Response(JSON.stringify({ error: 'paused' }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '600' },
      });
    }

    const limited = await overLimit(request, env, url.pathname);
    if (limited) return limited;

    const auth = await handleAuth(request, env, url);
    if (auth) return auth;
    const profile = await handleProfiles(request, env, url);
    if (profile) return profile;
    const puzzles = await handlePuzzles(request, env, url);
    if (puzzles) return puzzles;
    const daily = await handleDaily(request, env, url);
    if (daily) return daily;
    const leaders = await handleLeaderboard(request, env, url);
    if (leaders) return leaders;
    const rush = await handleRush(request, env, url);
    if (rush) return rush;
    const errors = await handleErrors(request, url);
    if (errors) return errors;
    const gangs = await handleGangs(request, env, url);
    if (gangs) return gangs;
    const follows = await handleFollows(request, env, url);
    if (follows) return follows;
    const challenges = await handleChallenges(request, env, url);
    if (challenges) return challenges;

    if (url.pathname === '/api/tv' && request.method === 'GET') {
      return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch(`https://lobby/tv${url.search}`);
    }
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch('https://lobby/stats');
    }
    if (url.pathname === '/api/lobby/ws') {
      // One lobby for the whole site. A signed-in player is told to it by these headers
      // (never taken from the browser), so nobody can play under someone else's username.
      const user = await currentUser(request, env).catch(() => null);
      return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch(withAccountHeaders(request, user));
    }
    if (url.pathname === '/api/games' && request.method === 'POST') {
      // The creator's account goes along (a rated game needs two signed-in players).
      const user = await currentUser(request, env).catch(() => null);
      return toRoom(env, withAccountHeaders(request, user), newGameId(), '/create');
    }
    const m = /^\/api\/games\/([^/]+)(?:\/(join|ws|record))?$/.exec(url.pathname);
    if (m) {
      if (!GAME_ID.test(m[1])) return notFound();
      if (m[2] === 'join') {
        const user = await currentUser(request, env).catch(() => null);
        return toRoom(env, withAccountHeaders(request, user), m[1], '/join');
      }
      return toRoom(env, withAccountHeaders(request, null), m[1], `/${m[2] ?? 'info'}`);
    }
    if (url.pathname.startsWith('/api/')) return notFound();

    const og = /^\/og\/([A-Za-z0-9]{8})\.png$/.exec(url.pathname);
    if (og) return toRoom(env, request, og[1], '/og');

    const page = /^\/([A-Za-z0-9]{8})(?:\/analysis)?\/?$/.exec(url.pathname);
    if (page && request.method === 'GET' && !paused) return gamePage(env, request, url, page[1]);
    if (url.pathname === '/sitemap.xml' && !paused) return sitemap(env, url);
    if (!paused && !url.pathname.startsWith('/api/')) {
      const preview = await pagePreview(env, request, url);
      if (preview) return preview;
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
