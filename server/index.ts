// Cloudflare Worker for punkchess.com: serves the built site (static assets)
// and the online game API. Each game lives in its own Durable Object.
//
//   POST /api/games               create a game -> { gameId, color, token }
//   POST /api/games/:id/join      take the free seat -> { gameId, color, token }
//   GET  /api/games/:id/ws        WebSocket (first message: { t: 'hello', token })
//   GET  /api/games/:id           what the game link shows (online room or stored local game)
//   GET  /api/lobby/ws            WebSocket to the lobby (open seeks, quick pairing)
//   PUT  /api/games/:id/record    stores a local game (bot / two players) so its link works anywhere
//   GET  /og/:id.png              link-preview picture of a game
// Game pages (/<id>, /<id>/analysis) get link-preview tags for that game.

import { GAME_ID } from '../src/online/protocol.ts';
import type { Env } from './game-room.ts';
import type { GameInfo } from '../src/online/record.ts';
import { previewTags, previewVersion } from './og.ts';

export { GameRoom } from './game-room.ts';
export { Lobby } from './lobby.ts';

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
/** Where new game rooms are created: close to the players (most play from Turkey). */
export const ROOM_LOCATION = { locationHint: 'eeur' } as const;

function toRoom(env: Env, request: Request, id: string, path: string): Promise<Response> {
  const stub = env.GAME.get(env.GAME.idFromName(id), ROOM_LOCATION);
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

    if (url.pathname === '/api/lobby/ws') {
      // One lobby for the whole site.
      return env.LOBBY.get(env.LOBBY.idFromName('main'), ROOM_LOCATION).fetch(request);
    }
    if (url.pathname === '/api/games' && request.method === 'POST') {
      return toRoom(env, request, newGameId(), '/create');
    }
    const m = /^\/api\/games\/([^/]+)(?:\/(join|ws|record))?$/.exec(url.pathname);
    if (m) {
      if (!GAME_ID.test(m[1])) return notFound();
      return toRoom(env, request, m[1], `/${m[2] ?? 'info'}`);
    }
    if (url.pathname.startsWith('/api/')) return notFound();

    const og = /^\/og\/([A-Za-z0-9]{8})\.png$/.exec(url.pathname);
    if (og) return toRoom(env, request, og[1], '/og');

    const page = /^\/([A-Za-z0-9]{8})(?:\/analysis)?\/?$/.exec(url.pathname);
    if (page && request.method === 'GET') return gamePage(env, request, url, page[1]);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
