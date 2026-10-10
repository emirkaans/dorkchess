// Cloudflare Worker for punkchess.com: serves the built site (static assets)
// and the online game API. Each game lives in its own Durable Object.
//
//   POST /api/games               create a game -> { gameId, color, token }
//   POST /api/games/:id/join      take the free seat -> { gameId, color, token }
//   GET  /api/games/:id/ws        WebSocket (first message: { t: 'hello', token })

import { GAME_ID } from '../src/online/protocol.ts';
import type { Env } from './game-room.ts';

export { GameRoom } from './game-room.ts';

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www.punkchess.com -> punkchess.com
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/games' && request.method === 'POST') {
      return toRoom(env, request, newGameId(), '/create');
    }
    const m = /^\/api\/games\/([^/]+)\/(join|ws)$/.exec(url.pathname);
    if (m) {
      if (!GAME_ID.test(m[1])) return notFound();
      return toRoom(env, request, m[1], `/${m[2]}`);
    }
    if (url.pathname.startsWith('/api/')) return notFound();
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
