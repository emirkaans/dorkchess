// One online game = one Durable Object. It keeps the Room (src/online/room.ts)
// in storage, holds both players' WebSockets (hibernation API) and uses an
// alarm for flag falls and the reconnect deadline.

import { DurableObject } from 'cloudflare:workers';
import type { Color } from '../src/engine/index.ts';
import { GAME_ID } from '../src/online/protocol.ts';
import type { ClientMessage, CreateRequest, ServerMessage } from '../src/online/protocol.ts';
import {
  RoomError,
  answerSetup,
  createRoom,
  draw,
  joinRoom,
  rematch,
  nextDeadline,
  playMove,
  resign,
  seatOf,
  setConnected,
  tick,
  viewOf,
} from '../src/online/room.ts';
import type { Room } from '../src/online/room.ts';
import { randomGameId, recordOfRoom, validateRecord } from '../src/online/record.ts';
import type { GameInfo, GameRecord, RecordSaved, RecordUpload } from '../src/online/record.ts';
import { previewVersion, renderPreview } from './og.ts';
import type { Lobby } from './lobby.ts';

export interface Env {
  readonly GAME: DurableObjectNamespace<GameRoom>;
  readonly LOBBY: DurableObjectNamespace<Lobby>;
  readonly ASSETS: Fetcher;
}

/** What a socket is: a seat colour, or a spectator. */
interface Attachment {
  readonly color: Color | null;
  /** The browser playing a stored local game (told when people start or stop following it). */
  readonly owner?: boolean;
}

const MAX_MESSAGE = 2048;
/** A stored local game: about 1000 moves of SAN with room to spare. */
const MAX_RECORD_BYTES = 32_000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private loaded = false;

  private async load(): Promise<Room | null> {
    if (!this.loaded) {
      this.room = (await this.ctx.storage.get<Room>('room')) ?? null;
      this.loaded = true;
    }
    return this.room;
  }

  private async save(room: Room): Promise<void> {
    this.room = room;
    await this.ctx.storage.put('room', room);
    const at = nextDeadline(room);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** Which seats have an open socket (`closing` is one being closed right now). */
  private connected(closing?: WebSocket): Record<Color, boolean> {
    const seen = { w: false, b: false };
    for (const ws of this.ctx.getWebSockets()) {
      const color = ws === closing ? null : this.colorOf(ws);
      if (color) seen[color] = true;
    }
    return seen;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket is closing; its close handler cleans up.
    }
  }

  private broadcast(room: Room, closing?: WebSocket) {
    const connected = this.connected(closing);
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== closing) this.send(ws, { t: 'view', view: viewOf(room, this.colorOf(ws), connected, now) });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') ?? '';
    if (!GAME_ID.test(id)) return json({ error: 'not-found' }, 404);
    try {
      if (url.pathname === '/create' && request.method === 'POST') return await this.create(id, request);
      if (url.pathname === '/join' && request.method === 'POST') return await this.join(request);
      if (url.pathname === '/ws') return await this.openSocket(request);
      if (url.pathname === '/info' && request.method === 'GET') return await this.info();
      if (url.pathname === '/og' && request.method === 'GET') return await this.preview();
      if (url.pathname === '/adopt' && request.method === 'POST') return await this.adopt(request);
      if (url.pathname === '/record' && request.method === 'PUT') return await this.putRecord(request);
    } catch (e) {
      if (e instanceof RoomError) return json({ error: e.code }, e.code === 'not-found' ? 404 : 400);
      throw e;
    }
    return json({ error: 'not-found' }, 404);
  }

  /** Takes over a room prepared by another game (a rematch); only for an empty id. */
  private async adopt(request: Request): Promise<Response> {
    if ((await this.load()) || (await this.ctx.storage.get('record'))) return json({ error: 'bad-request' }, 409);
    const room = (await request.json()) as Room;
    await this.save(room);
    return json({ ok: true });
  }

  /** The game behind a link: an online room, or a local game uploaded by its player. */
  private async info(): Promise<Response> {
    const room = await this.load();
    if (room) return json({ kind: 'online', phase: room.phase, record: recordOfRoom(room) } satisfies GameInfo);
    const stored = await this.ctx.storage.get<{ record: GameRecord }>('record');
    if (stored) return json({ kind: 'local', record: stored.record } satisfies GameInfo);
    return json({ error: 'not-found' }, 404);
  }

  /** The game's record: an online room's moves, or the stored local game. */
  private async record(): Promise<GameRecord | null> {
    const room = await this.load();
    if (room) return recordOfRoom(room);
    return (await this.ctx.storage.get<{ record: GameRecord }>('record'))?.record ?? null;
  }

  /**
   * The link-preview picture of the current position. Drawn here (a Durable
   * Object may use more CPU than a plain request) and kept until the game changes.
   */
  private async preview(): Promise<Response> {
    const record = await this.record();
    if (!record) return json({ error: 'not-found' }, 404);
    const version = previewVersion(record);
    let cached = await this.ctx.storage.get<{ version: string; png: Uint8Array }>('og');
    if (!cached || cached.version !== version) {
      cached = { version, png: await renderPreview(record) };
      await this.ctx.storage.put('og', cached);
    }
    return new Response(cached.png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': record.result === '*' ? 'public, max-age=60' : 'public, max-age=86400',
      },
    });
  }

  /** Stores (or updates) a local game; only the browser that first stored it may update it. */
  private async putRecord(request: Request): Promise<Response> {
    if (await this.load()) return json({ error: 'bad-request' }, 409);
    const text = await request.text();
    if (text.length > MAX_RECORD_BYTES) return json({ error: 'bad-request' }, 413);
    let body: Partial<RecordUpload>;
    try {
      body = JSON.parse(text) as Partial<RecordUpload>;
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const record = validateRecord(body.record);
    const owner = typeof body.owner === 'string' ? body.owner.slice(0, 80) : '';
    if (!record || owner.length < 16) return json({ error: 'bad-request' }, 400);
    const stored = await this.ctx.storage.get<{ owner: string }>('record');
    if (stored && stored.owner !== owner) return json({ error: 'bad-request' }, 403);
    await this.ctx.storage.put('record', { record, owner });
    // People following the game get the new moves at once; the uploader learns whether
    // anyone watches (then it uploads after every move, otherwise only now and then).
    for (const ws of this.ctx.getWebSockets()) if (!this.isOwner(ws)) this.send(ws, { t: 'record', record });
    return json({ ok: true, watchers: this.watchers() } satisfies RecordSaved);
  }

  private async create(id: string, request: Request): Promise<Response> {
    if ((await this.load()) || (await this.ctx.storage.get('record'))) return json({ error: 'bad-request' }, 409);
    const body = (await request.json()) as CreateRequest;
    const token = crypto.randomUUID();
    const { room, color } = createRoom(id, body, token, Math.random);
    await this.save(room);
    return json({ gameId: id, color, token });
  }

  private async join(request: Request): Promise<Response> {
    const room = await this.load();
    if (!room) return json({ error: 'not-found' }, 404);
    const body = (await request.json()) as { name?: unknown };
    const token = crypto.randomUUID();
    const joined = joinRoom(room, typeof body.name === 'string' ? body.name : '', token);
    await this.save(joined.room);
    this.broadcast(joined.room);
    return json({ gameId: room.id, color: joined.color, token });
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'bad-request' }, 426);
    const room = await this.load();
    // A stored local game can be followed too (its record comes on every update).
    if (!room && !(await this.ctx.storage.get('record'))) return json({ error: 'not-found' }, 404);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // A socket starts as a spectator; its first message ("hello") may claim a seat.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ color: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      return this.send(ws, { t: 'error', code: 'bad-request' });
    }
    const room = await this.load();
    if (!room) {
      // Following a local game: "hello" answers with the record, "ping" keeps the line open.
      if (msg.t === 'ping') return this.send(ws, { t: 'pong', now: Date.now() });
      const stored = await this.ctx.storage.get<{ record: GameRecord; owner: string }>('record');
      if (msg.t !== 'hello' || !stored) return this.send(ws, { t: 'error', code: 'not-found' });
      if (typeof msg.token === 'string' && msg.token === stored.owner) {
        ws.serializeAttachment({ color: null, owner: true } satisfies Attachment);
        return this.send(ws, { t: 'watchers', count: this.watchers() });
      }
      this.send(ws, { t: 'record', record: stored.record });
      return this.tellOwners();
    }
    const now = Date.now();
    const color = this.colorOf(ws);

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', now });
    if (msg.t === 'hello') return this.hello(ws, room, msg.token, now);
    if (!color) return this.send(ws, { t: 'error', code: 'bad-request' });

    try {
      let next: Room;
      switch (msg.t) {
        case 'move':
          next = playMove(room, color, msg.move, msg.ply, now, typeof msg.lag === 'number' ? msg.lag : 0);
          break;
        case 'setup':
          next = answerSetup(room, color, msg.answers);
          break;
        case 'resign':
          next = resign(room, color, now);
          break;
        case 'draw':
          next = draw(room, color, msg.action, now);
          break;
        case 'rematch': {
          const r = rematch(room, color, msg.action, randomGameId());
          if (r.next) {
            const stub = this.env.GAME.get(this.env.GAME.idFromName(r.next.id), { locationHint: 'eeur' });
            const res = await stub.fetch(`https://room/adopt?id=${r.next.id}`, {
              method: 'POST',
              body: JSON.stringify(r.next),
            });
            if (!res.ok) return this.send(ws, { t: 'error', code: 'bad-request' });
          }
          next = r.room;
          break;
        }
        default:
          return this.send(ws, { t: 'error', code: 'bad-request' });
      }
      await this.save(next);
      this.broadcast(next);
    } catch (e) {
      if (!(e instanceof RoomError)) throw e;
      this.send(ws, { t: 'error', code: e.code });
      // Resend the truth so the client can undo whatever it showed.
      this.send(ws, { t: 'view', view: viewOf(room, color, this.connected(), now) });
    }
  }

  /** A socket identifies itself: a seat token makes it that player's (and cancels a reconnect countdown). */
  private async hello(ws: WebSocket, room: Room, token: string | null, now: number) {
    const color = seatOf(room, typeof token === 'string' ? token : null);
    if (color) {
      ws.serializeAttachment({ color } satisfies Attachment);
      room = tick(setConnected(room, color, true, now), now);
      await this.save(room);
    }
    this.broadcast(room);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  private async dropped(ws: WebSocket) {
    const color = this.colorOf(ws);
    const room = await this.load();
    if (!room && !this.isOwner(ws)) return this.tellOwners(ws);
    if (!room || !color) return;
    // Another tab of the same player still holds the seat.
    if (this.connected(ws)[color]) return;
    const next = setConnected(room, color, false, Date.now());
    await this.save(next);
    this.broadcast(next, ws);
  }

  private isOwner(ws: WebSocket): boolean {
    return !!(ws.deserializeAttachment() as Attachment | null)?.owner;
  }

  /** People following a stored local game (its owner's own socket excluded). */
  private watchers(closing?: WebSocket): number {
    return this.ctx.getWebSockets().filter((ws) => ws !== closing && !this.isOwner(ws)).length;
  }

  /** Tells the playing browser how many follow its game (it then uploads every move, or now and then). */
  private tellOwners(closing?: WebSocket) {
    const count = this.watchers(closing);
    for (const ws of this.ctx.getWebSockets()) if (this.isOwner(ws)) this.send(ws, { t: 'watchers', count });
  }

  private colorOf(ws: WebSocket): Color | null {
    return ((ws.deserializeAttachment() as Attachment | null) ?? { color: null }).color;
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) return;
    const next = tick(room, Date.now());
    await this.save(next);
    if (next !== room) this.broadcast(next);
  }
}
