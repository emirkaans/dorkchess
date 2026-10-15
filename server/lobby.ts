// The lobby: one Durable Object for the whole site. Browsers on /online keep a
// WebSocket to it; each connection may hold one open seek. Seeks live in the
// sockets' attachments (no storage writes), so a seek disappears with its
// connection and survives the object being hibernated. A pairing makes the
// game room with both seats taken (GameRoom /adopt) and sends each side its
// seat ticket.
//
// Game rooms also tell the lobby when a game starts and ends (/live), so the
// home page can show how many games are being played (/stats).

import { DurableObject } from 'cloudflare:workers';
import type { Presence } from '../src/online/follow.ts';
import { createRoom, joinRoom } from '../src/online/room.ts';
import { randomGameId } from '../src/online/record.ts';
import { QUICK_VARIANT, cleanPlayer, gameRequest, makeSeek, quickMatch, sortSeeks } from '../src/online/lobby.ts';
import { LIVE_GAME_MAX_MS, pickTv } from '../src/online/lobby.ts';
import type {
  LiveGame,
  LiveStats,
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
  Seek,
  TvResponse,
} from '../src/online/lobby.ts';
import type { Env } from './game-room.ts';
import { ACCOUNT_ID, ACCOUNT_NAME } from './account-headers.ts';
import type { SeatAccount } from '../src/online/room.ts';
import { ratingCategory } from '../src/rating/categories.ts';
import { DEFAULT_GLICKO, PROVISIONAL_RD } from '../src/rating/glicko2.ts';

interface Attachment {
  readonly player: LobbyPlayer | null;
  readonly seek: Seek | null;
  /** The signed-in account (set by the Worker): name and id are fixed. */
  readonly account?: SeatAccount | null;
  /** Its ratings by category (looked up when the connection opens). */
  readonly ratings?: Readonly<Record<string, { rating: number; provisional: boolean }>>;
}

const MAX_MESSAGE = 1024;
/** Messages a connection may send in BURST_MS (pings aside); each one is sent on to everyone. */
const BURST = 20;
const BURST_MS = 10_000;

export class Lobby extends DurableObject<Env> {
  // Recent message times per connection (kept in memory: a hibernated lobby starts afresh).
  private recent = new WeakMap<WebSocket, number[]>();

  /** Too many messages from one connection: the rest of the burst is dropped. */
  private flooding(ws: WebSocket): boolean {
    const now = Date.now();
    const times = (this.recent.get(ws) ?? []).filter((t) => now - t < BURST_MS);
    times.push(now);
    this.recent.set(ws, times);
    return times.length > BURST;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/live' && request.method === 'POST') return this.live(url, request);
    if (url.pathname === '/tv' && request.method === 'GET') return this.tv(url);
    if (url.pathname === '/presence' && request.method === 'POST') return this.presence(request);
    if (url.pathname === '/stats' && request.method === 'GET') return this.stats();
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const accountId = request.headers.get(ACCOUNT_ID);
    const username = request.headers.get(ACCOUNT_NAME);
    const account: SeatAccount | null = accountId && username ? { id: accountId, username } : null;
    const player: LobbyPlayer | null = account
      ? { id: `account-${account.id}`, name: account.username, rating: null, account: true }
      : null;
    server.serializeAttachment({
      player,
      seek: null,
      account,
      ratings: account ? await this.ratingsOf(account.id) : undefined,
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Games being played, by id (entries from before they carried details are only counted). */
  private async liveGames(): Promise<Map<string, LiveGame | number>> {
    const games =
      (await this.ctx.storage.get<Map<string, LiveGame | number>>('live')) ?? new Map<string, LiveGame | number>();
    const old = Date.now() - LIVE_GAME_MAX_MS;
    for (const [id, g] of games) if ((typeof g === 'number' ? g : g.at) < old) games.delete(id);
    return games;
  }

  /** A game room says a game started (on=1, with its players in the body) or ended (on=0). */
  private async live(url: URL, request: Request): Promise<Response> {
    const id = url.searchParams.get('id');
    if (!id) return new Response('bad request', { status: 400 });
    const games = await this.liveGames();
    if (url.searchParams.get('on') === '1') {
      const body = (await request.json().catch(() => null)) as Partial<LiveGame> | null;
      games.set(id, {
        id,
        at: Date.now(),
        white: String(body?.white ?? ''),
        black: String(body?.black ?? ''),
        variantId: String(body?.variantId ?? ''),
        timeControlId: String(body?.timeControlId ?? ''),
        rated: body?.rated === true,
        rating: typeof body?.rating === 'number' ? body.rating : null,
      });
    } else games.delete(id);
    await this.ctx.storage.put('live', games);
    return new Response(null, { status: 204 });
  }

  /** Which of the asked usernames are in the lobby, and which are playing (and where). */
  private async presence(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
    const names = new Set(
      Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === 'string') : [],
    );
    const lobby = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.attachment(ws);
      if (a.account && names.has(a.account.username)) lobby.add(a.account.username);
    }
    const games: Record<string, string> = {};
    for (const g of (await this.liveGames()).values()) {
      if (typeof g === 'number') continue;
      if (names.has(g.white)) games[g.white] = g.id;
      if (names.has(g.black)) games[g.black] = g.id;
    }
    const presence: Presence = { lobby: [...lobby], games };
    return new Response(JSON.stringify(presence), { headers: { 'content-type': 'application/json' } });
  }

  /** The game to watch now (?skip=<id>: another one than that, when there is one). */
  private async tv(url: URL): Promise<Response> {
    const games = [...(await this.liveGames()).values()].filter((g): g is LiveGame => typeof g !== 'number');
    const skip = url.searchParams.get('skip');
    const game = pickTv(games, skip) ?? pickTv(games);
    return new Response(JSON.stringify({ game } satisfies TvResponse), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  private async stats(): Promise<Response> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const p = this.attachment(ws).player;
      if (p) ids.add(p.id);
    }
    const stats: LiveStats = { games: (await this.liveGames()).size, players: ids.size };
    return new Response(JSON.stringify(stats), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=15' },
    });
  }

  /** A signed-in player's ratings by category (empty when there are none or the database fails). */
  private async ratingsOf(userId: string): Promise<Record<string, { rating: number; provisional: boolean }>> {
    try {
      const rows = await this.env.DB.prepare('SELECT category, rating, rd FROM ratings WHERE user_id = ?1')
        .bind(userId)
        .all<{ category: string; rating: number; rd: number }>();
      return Object.fromEntries(
        rows.results.map((r) => [r.category, { rating: Math.round(r.rating), provisional: r.rd > PROVISIONAL_RD }]),
      );
    } catch {
      return {};
    }
  }

  /** The player as shown on a seek: with the rating of its category. */
  private seekPlayer(ws: WebSocket, variantId: string, timeControlId: string): LobbyPlayer | null {
    const a = this.attachment(ws);
    if (!a.player) return null;
    if (!a.account) return a.player;
    const category = ratingCategory(variantId, timeControlId);
    const r = category ? (a.ratings?.[category] ?? { rating: DEFAULT_GLICKO.rating, provisional: true }) : null;
    return { ...a.player, rating: r?.rating ?? null, provisional: r?.provisional ?? false };
  }

  private attachment(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { player: null, seek: null };
  }

  private setSeek(ws: WebSocket, seek: Seek | null) {
    ws.serializeAttachment({ ...this.attachment(ws), seek } satisfies Attachment);
  }

  private send(ws: WebSocket, msg: LobbyServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closing; its close handler updates the others
    }
  }

  /** Sends every connection the seek list (and which one is its own). */
  private broadcast(closing?: WebSocket) {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== closing);
    const seeks: Seek[] = [];
    const ids = new Set<string>();
    for (const ws of sockets) {
      const a = this.attachment(ws);
      if (a.seek) seeks.push(a.seek);
      if (a.player) ids.add(a.player.id);
    }
    const sorted = sortSeeks(seeks);
    for (const ws of sockets) {
      const a = this.attachment(ws);
      if (a.player) this.send(ws, { t: 'state', seeks: sorted, online: ids.size, mySeek: a.seek?.id ?? null });
    }
  }

  /** The connection holding a seek. */
  private holderOf(seekId: string): WebSocket | null {
    return this.ctx.getWebSockets().find((ws) => this.attachment(ws).seek?.id === seekId) ?? null;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE)
      return this.send(ws, { t: 'error', code: 'bad-request' });
    let msg: LobbyClientMessage;
    try {
      msg = JSON.parse(data) as LobbyClientMessage;
    } catch {
      return this.send(ws, { t: 'error', code: 'bad-request' });
    }
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (this.flooding(ws)) return;
    if (msg.t === 'hello') {
      // A signed-in player keeps the account's id and username.
      if (this.attachment(ws).account) return this.broadcast();
      const player = cleanPlayer(msg.playerId, msg.name);
      if (!player) return this.send(ws, { t: 'error', code: 'bad-request' });
      ws.serializeAttachment({ player, seek: null, account: null } satisfies Attachment);
      return this.broadcast();
    }
    const me = this.attachment(ws).player;
    if (!me) return this.send(ws, { t: 'error', code: 'bad-request' });

    switch (msg.t) {
      case 'name': {
        if (this.attachment(ws).account) return;
        const player = cleanPlayer(me.id, msg.name);
        if (!player) return;
        const seek = this.attachment(ws).seek;
        ws.serializeAttachment({
          ...this.attachment(ws),
          player,
          seek: seek && { ...seek, player },
        } satisfies Attachment);
        return this.broadcast();
      }
      case 'seek': {
        const player = this.seekPlayer(ws, String(msg.variantId), String(msg.timeControlId)) ?? me;
        const seek = makeSeek(crypto.randomUUID(), player, msg, false, Date.now());
        if (!seek) return this.send(ws, { t: 'error', code: 'bad-request' });
        this.setSeek(ws, seek);
        return this.broadcast();
      }
      case 'quick': {
        const seeks = this.ctx.getWebSockets().flatMap((s) => this.attachment(s).seek ?? []);
        // Signed-in players are paired rated among themselves; guests casual.
        const rated = !!this.attachment(ws).account;
        const match = quickMatch(seeks, msg.timeControlId, me.id, rated);
        if (match) return this.pair(match, ws);
        const player = this.seekPlayer(ws, QUICK_VARIANT(), String(msg.timeControlId)) ?? me;
        const seek = makeSeek(
          crypto.randomUUID(),
          player,
          { variantId: QUICK_VARIANT(), timeControlId: msg.timeControlId, color: 'random', rated },
          true,
          Date.now(),
        );
        if (!seek) return this.send(ws, { t: 'error', code: 'bad-request' });
        this.setSeek(ws, seek);
        return this.broadcast();
      }
      case 'cancel':
        this.setSeek(ws, null);
        return this.broadcast();
      case 'accept': {
        const holder = typeof msg.seekId === 'string' ? this.holderOf(msg.seekId) : null;
        const seek = holder && this.attachment(holder).seek;
        if (!holder || !seek) return this.send(ws, { t: 'error', code: 'gone' });
        if (seek.player.id === me.id) return this.send(ws, { t: 'error', code: 'own-seek' });
        if (seek.rated && !this.attachment(ws).account)
          return this.send(ws, { t: 'error', code: 'rated-needs-account' });
        return this.pair(seek, ws);
      }
      default:
        return this.send(ws, { t: 'error', code: 'bad-request' });
    }
  }

  /** Starts a game between a seek's owner and the player taking it. */
  private async pair(seek: Seek, taker: WebSocket) {
    const holder = this.holderOf(seek.id);
    const me = this.attachment(taker).player;
    if (!holder || !me) return this.send(taker, { t: 'error', code: 'gone' });
    // Taken off the list before waiting on the game room, so nobody else takes it meanwhile.
    this.setSeek(holder, null);
    const ownSeek = this.attachment(taker).seek;
    this.setSeek(taker, null);

    const gameId = randomGameId();
    const seekerToken = crypto.randomUUID();
    const takerToken = crypto.randomUUID();
    const req = gameRequest(seek, Math.random);
    const created = createRoom(gameId, req, seekerToken, Math.random, this.attachment(holder).account ?? null);
    const joined = joinRoom(created.room, me.name, takerToken, this.attachment(taker).account ?? null);
    const stub = this.env.GAME.get(this.env.GAME.idFromName(gameId));
    const res = await stub.fetch(`https://room/adopt?id=${gameId}`, {
      method: 'POST',
      body: JSON.stringify(joined.room),
    });
    if (!res.ok) {
      this.setSeek(holder, seek);
      this.setSeek(taker, ownSeek);
      this.send(taker, { t: 'error', code: 'gone' });
      return this.broadcast();
    }
    this.send(holder, { t: 'paired', ticket: { gameId, color: created.color, token: seekerToken } });
    this.send(taker, { t: 'paired', ticket: { gameId, color: joined.color, token: takerToken } });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcast(ws);
  }
}
