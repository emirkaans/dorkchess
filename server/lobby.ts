// The lobby: one Durable Object for the whole site. Browsers on /online keep a
// WebSocket to it; each connection may hold one open seek. Seeks live in the
// sockets' attachments (no storage writes), so a seek disappears with its
// connection and survives the object being hibernated. A pairing makes the
// game room with both seats taken (GameRoom /adopt) and sends each side its
// seat ticket.

import { DurableObject } from 'cloudflare:workers';
import { createRoom, joinRoom } from '../src/online/room.ts';
import { randomGameId } from '../src/online/record.ts';
import { QUICK_VARIANT, cleanPlayer, gameRequest, makeSeek, quickMatch, sortSeeks } from '../src/online/lobby.ts';
import type { LobbyClientMessage, LobbyPlayer, LobbyServerMessage, Seek } from '../src/online/lobby.ts';
import type { Env } from './game-room.ts';

interface Attachment {
  readonly player: LobbyPlayer | null;
  readonly seek: Seek | null;
}

const MAX_MESSAGE = 1024;

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ player: null, seek: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
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
    if (msg.t === 'hello') {
      const player = cleanPlayer(msg.playerId, msg.name);
      if (!player) return this.send(ws, { t: 'error', code: 'bad-request' });
      ws.serializeAttachment({ player, seek: null } satisfies Attachment);
      return this.broadcast();
    }
    const me = this.attachment(ws).player;
    if (!me) return this.send(ws, { t: 'error', code: 'bad-request' });

    switch (msg.t) {
      case 'name': {
        const player = cleanPlayer(me.id, msg.name);
        if (!player) return;
        const seek = this.attachment(ws).seek;
        ws.serializeAttachment({ player, seek: seek && { ...seek, player } } satisfies Attachment);
        return this.broadcast();
      }
      case 'seek': {
        const seek = makeSeek(crypto.randomUUID(), me, msg, false, Date.now());
        if (!seek) return this.send(ws, { t: 'error', code: 'bad-request' });
        this.setSeek(ws, seek);
        return this.broadcast();
      }
      case 'quick': {
        const seeks = this.ctx.getWebSockets().flatMap((s) => this.attachment(s).seek ?? []);
        const match = quickMatch(seeks, msg.timeControlId, me.id);
        if (match) return this.pair(match, ws);
        const seek = makeSeek(
          crypto.randomUUID(),
          me,
          { variantId: QUICK_VARIANT(), timeControlId: msg.timeControlId, color: 'random' },
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
    const created = createRoom(gameId, req, seekerToken, Math.random);
    const joined = joinRoom(created.room, me.name, takerToken);
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
