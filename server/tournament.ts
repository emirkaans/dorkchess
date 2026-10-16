// Arena tournaments (src/online/tournament.ts has the rules):
//
//   GET  /api/tournaments              live, upcoming and recently finished ones (D1)
//   POST /api/tournaments { … }        a signed-in player makes one (one open at a time)
//   GET  /api/tournaments/:id          its standings (the Durable Object)
//   GET  /api/tournaments/:id/ws       its WebSocket: standings as they change, pairings
//
// Each tournament is a Durable Object. While it runs, an alarm pairs the free
// players every few seconds: joined, not paused, not in a game, and with the
// tournament page open (a WebSocket). Their game rooms report the result
// (/result); a room that could not report is asked for it later.

import { DurableObject } from 'cloudflare:workers';
import { timeControl } from '../src/clock/clock.ts';
import { listVariants } from '../src/engine/index.ts';
import { randomGameId } from '../src/online/record.ts';
import { ABORT_PLIES, createRoom, joinRoom } from '../src/online/room.ts';
import type { Room, SeatAccount } from '../src/online/room.ts';
import type { Color } from '../src/engine/index.ts';
import type { GameInfo } from '../src/online/record.ts';
import {
  PAIRING_MS,
  TOURNAMENT_MAX_PLAYERS,
  TOURNAMENT_MINUTES,
  TOURNAMENT_START_IN,
  TOURNAMENT_TIME_CONTROLS,
  newPlayer,
  onFire,
  pairings,
  resultFor,
  scored,
  standings,
  tournamentNameProblem,
} from '../src/online/tournament.ts';
import type {
  CreateTournament,
  TournamentClientMessage,
  TournamentList,
  TournamentMeta,
  TournamentPlayer,
  TournamentServerMessage,
  TournamentState,
  TournamentSummary,
  TournamentView,
} from '../src/online/tournament.ts';
import { ACCOUNT_ID, ACCOUNT_NAME } from './account-headers.ts';
import { withAccountHeaders } from './account-headers.ts';
import { currentUser, sameOrigin } from './auth.ts';
import type { Env } from './game-room.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const ID = /^[A-Za-z0-9]{8}$/;
const MAX_MESSAGE = 256;

/** A game being played in the tournament. */
interface LiveGame {
  readonly w: string;
  readonly b: string;
  readonly at: number;
  /** Both sides have moved (it will not be a no-show). */
  readonly started?: boolean;
}

/** Time to make the first move (each side) before a tournament game is called off as a no-show. */
const FIRST_MOVE_MS = 30_000;

/** Longest a game of this time control should take; after that its room is asked how it ended. */
function overdueMs(timeControlId: string): number {
  const tc = timeControl(timeControlId);
  return 2 * (tc.initialMs ?? 0) + 160 * tc.incrementMs + 5 * 60_000;
}

export class Tournament extends DurableObject<Env> {
  private state: TournamentState | null = null;
  private games: Record<string, LiveGame> = {};
  private loaded = false;

  private async load(): Promise<TournamentState | null> {
    if (!this.loaded) {
      this.state = (await this.ctx.storage.get<TournamentState>('state')) ?? null;
      this.games = (await this.ctx.storage.get<Record<string, LiveGame>>('games')) ?? {};
      this.loaded = true;
    }
    return this.state;
  }

  private async save(state: TournamentState) {
    this.state = state;
    await this.ctx.storage.put({ state, games: this.games });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') return this.init(request);
    if (url.pathname === '/cancel' && request.method === 'POST') {
      // Called off by staff (server/admin.ts): everyone on the page is told, then it is gone.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.state = null;
      this.games = {};
      for (const ws of this.ctx.getWebSockets()) ws.close(4404, 'cancelled');
      return json({ ok: true });
    }
    const state = await this.load();
    if (!state) return json({ error: 'not-found' }, 404);
    if (url.pathname === '/result' && request.method === 'POST') {
      await this.result((await request.json()) as GameEnd);
      return json({ ok: true });
    }
    if (url.pathname === '/view') return json(this.view(state, null));
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const id = request.headers.get(ACCOUNT_ID);
    const username = request.headers.get(ACCOUNT_NAME);
    server.serializeAttachment((id && username ? { id, username } : null) satisfies SeatAccount | null);
    this.send(server, { t: 'state', view: this.view(state, id) });
    await this.wake();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Someone came to the page or joined while the pairing alarm sleeps (nobody was there): pair soon. */
  private async wake() {
    if (this.state?.status !== 'started') return;
    const at = await this.ctx.storage.getAlarm();
    if (at === null || at > Date.now() + PAIRING_MS) await this.ctx.storage.setAlarm(Date.now() + PAIRING_MS);
  }

  private async init(request: Request): Promise<Response> {
    if (await this.load()) return json({ error: 'bad-request' }, 409);
    const meta = (await request.json()) as TournamentMeta;
    await this.save({ ...meta, status: 'created', players: {} });
    await this.ctx.storage.setAlarm(meta.startsAt);
    return json({ ok: true });
  }

  private view(state: TournamentState, you: string | null): TournamentView {
    const list = standings(Object.values(state.players));
    return {
      id: state.id,
      name: state.name,
      variantId: state.variantId,
      timeControlId: state.timeControlId,
      rated: state.rated,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      createdBy: state.createdBy,
      status: state.status,
      standings: list.map((p) => ({
        userId: p.userId,
        username: p.username,
        score: p.score,
        sheet: p.sheet,
        streak: p.streak,
        paused: p.paused,
        game: p.game,
        fire: onFire(p),
      })),
      games: Object.keys(this.games).length,
      you: you && state.players[you] ? you : null,
      now: Date.now(),
    };
  }

  private send(ws: WebSocket, msg: TournamentServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closed meanwhile
    }
  }

  private account(ws: WebSocket): SeatAccount | null {
    return (ws.deserializeAttachment() as SeatAccount | null) ?? null;
  }

  private broadcast() {
    const state = this.state;
    if (!state) return;
    for (const ws of this.ctx.getWebSockets())
      this.send(ws, { t: 'state', view: this.view(state, this.account(ws)?.id ?? null) });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg: TournamentClientMessage;
    try {
      msg = JSON.parse(raw) as TournamentClientMessage;
    } catch {
      return;
    }
    const state = await this.load();
    if (!state || msg.t === 'ping') return;
    const me = this.account(ws);
    if (!me) return this.send(ws, { t: 'error', code: 'signed-out' });
    if (state.status === 'finished') return this.send(ws, { t: 'error', code: 'finished' });
    const mine = state.players[me.id];
    if (msg.t === 'join') {
      if (!mine && Object.keys(state.players).length >= TOURNAMENT_MAX_PLAYERS) {
        return this.send(ws, { t: 'error', code: 'full' });
      }
      const player = mine ? { ...mine, paused: false } : newPlayer(me.id, me.username);
      await this.save({ ...state, players: { ...state.players, [me.id]: player } });
      if (!mine) await this.countPlayers();
      await this.wake();
    } else if (msg.t === 'withdraw') {
      if (!mine) return;
      // Before the start a player just leaves; once it runs, their points stay and they are paused.
      const players = { ...state.players };
      if (state.status === 'created') delete players[me.id];
      else players[me.id] = { ...mine, paused: true };
      await this.save({ ...state, players });
      if (state.status === 'created') await this.countPlayers();
    } else return;
    this.broadcast();
  }

  async webSocketClose() {}
  async webSocketError() {}

  private async countPlayers() {
    const state = this.state;
    if (!state || !this.env.DB) return;
    await this.env.DB.prepare('UPDATE tournaments SET players = ?1 WHERE id = ?2')
      .bind(Object.keys(state.players).length, state.id)
      .run()
      .catch(() => undefined);
  }

  async alarm() {
    const state = await this.load();
    if (!state || state.status === 'finished') return;
    const now = Date.now();
    if (now >= state.endsAt) return this.finish();
    if (state.status === 'created') {
      await this.save({ ...state, status: 'started' });
      await this.env.DB?.prepare("UPDATE tournaments SET status = 'started' WHERE id = ?1")
        .bind(state.id)
        .run()
        .catch(() => undefined);
    }
    await this.checkOverdue(now);
    await this.pair();
    // Nobody on the page and no game going: nothing to pair for a while.
    const idle = this.ctx.getWebSockets().length === 0 && Object.keys(this.games).length === 0;
    await this.ctx.storage.setAlarm(Math.min(state.endsAt, Date.now() + (idle ? 30_000 : PAIRING_MS)));
  }

  /** Pairs the free players who have the page open. */
  private async pair() {
    const state = this.state;
    if (!state) return;
    const present = new Map<string, SeatAccount>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.account(ws);
      if (a) present.set(a.id, a);
    }
    const free = Object.values(state.players).filter((p) => !p.paused && !p.game && present.has(p.userId));
    const pairs = pairings(free, Math.random);
    if (pairs.length === 0) return;
    let players = { ...state.players };
    for (const [w, b] of pairs) {
      const gameId = randomGameId();
      const tokens = { w: crypto.randomUUID(), b: crypto.randomUUID() };
      const seat = (id: string): SeatAccount => ({ id, username: players[id].username });
      const created = createRoom(
        gameId,
        { variantId: state.variantId, timeControlId: state.timeControlId, color: 'w', name: '', rated: state.rated },
        tokens.w,
        Math.random,
        seat(w),
      );
      const joined = joinRoom(created.room, '', tokens.b, seat(b));
      const room: Room = { ...joined.room, tournamentId: state.id };
      const res = await this.env.GAME.get(this.env.GAME.idFromName(gameId))
        .fetch(`https://room/adopt?id=${gameId}`, { method: 'POST', body: JSON.stringify(room) })
        .catch(() => null);
      if (!res?.ok) continue;
      this.games[gameId] = { w, b, at: Date.now() };
      players = {
        ...players,
        [w]: { ...players[w], game: gameId, lastOpponent: b, colorBalance: players[w].colorBalance + 1 },
        [b]: { ...players[b], game: gameId, lastOpponent: w, colorBalance: players[b].colorBalance - 1 },
      };
      for (const ws of this.ctx.getWebSockets()) {
        const id = this.account(ws)?.id;
        const color: Color | null = id === w ? 'w' : id === b ? 'b' : null;
        if (color) this.send(ws, { t: 'paired', ticket: { gameId, color, token: tokens[color] } });
      }
    }
    await this.save({ ...state, players });
    this.broadcast();
  }

  /** Games past their longest possible length: their rooms are asked how they ended. */
  private async checkOverdue(now: number) {
    const state = this.state;
    if (!state) return;
    const limit = overdueMs(state.timeControlId);
    for (const [gameId, g] of Object.entries(this.games)) {
      const age = now - g.at;
      if (!g.started && age >= FIRST_MOVE_MS) {
        // Not started yet: White has FIRST_MOVE_MS for the first move, Black as long again for theirs.
        const room = this.env.GAME.get(this.env.GAME.idFromName(gameId));
        const res = await room.fetch(`https://room/info?id=${gameId}`).catch(() => null);
        const info = res?.ok ? ((await res.json()) as GameInfo) : null;
        const plies = info?.record?.moves.length ?? 0;
        if (info?.kind === 'online' && info.phase !== 'over') {
          if (plies >= ABORT_PLIES) this.games[gameId] = { ...g, started: true };
          else if (plies === 0 || age >= 2 * FIRST_MOVE_MS) {
            // The room ends it and reports back (/result).
            await room.fetch(`https://room/noshow?id=${gameId}`, { method: 'POST' }).catch(() => null);
          }
          continue;
        }
      }
      if (age < limit) continue;
      const res = await this.env.GAME.get(this.env.GAME.idFromName(gameId))
        .fetch(`https://room/info?id=${gameId}`)
        .catch(() => null);
      const info = res?.ok ? ((await res.json()) as GameInfo) : null;
      if (info?.kind === 'online' && info.phase !== 'over') continue;
      const winner = info?.record?.result === '1-0' ? 'w' : info?.record?.result === '0-1' ? 'b' : null;
      await this.result({ gameId, winner, plies: info?.record?.moves.length ?? 0 });
    }
  }

  /** A tournament game ended (told by its room). */
  private async result(end: GameEnd) {
    const state = this.state;
    const g = this.games[end.gameId];
    if (!state || !g) return;
    delete this.games[end.gameId];
    const players = { ...state.players };
    const free = (id: string): TournamentPlayer => ({ ...players[id], game: null });
    if (state.status === 'finished') {
      // Games still going at the end do not count.
    } else if (end.plies < ABORT_PLIES) {
      // Aborted: no points; whoever kept the game from starting (or left it) is paused.
      const idle = end.winner ? (end.winner === 'w' ? g.b : g.w) : end.plies === 0 ? g.w : g.b;
      players[g.w] = { ...free(g.w), paused: idle === g.w || players[g.w].paused };
      players[g.b] = { ...free(g.b), paused: idle === g.b || players[g.b].paused };
    } else {
      players[g.w] = scored(players[g.w], end.gameId, resultFor('w', end.winner), end.plies);
      players[g.b] = scored(players[g.b], end.gameId, resultFor('b', end.winner), end.plies);
    }
    for (const id of [g.w, g.b]) if (players[id] && players[id].game === end.gameId) players[id] = free(id);
    await this.save({ ...state, players });
    this.broadcast();
  }

  private async finish() {
    const state = this.state;
    if (!state) return;
    const players = Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, { ...p, game: null }]),
    ) as Record<string, TournamentPlayer>;
    const done: TournamentState = { ...state, status: 'finished', players };
    this.games = {};
    await this.save(done);
    await this.ctx.storage.deleteAlarm();
    const list = standings(Object.values(players));
    await this.env.DB?.prepare(
      "UPDATE tournaments SET status = 'finished', players = ?1, winner = ?2, standings = ?3 WHERE id = ?4",
    )
      .bind(
        list.length,
        list[0] && list[0].score > 0 ? list[0].username : null,
        JSON.stringify(list.slice(0, 50).map((p) => ({ username: p.username, score: p.score, games: p.sheet.length }))),
        state.id,
      )
      .run()
      .catch((e: unknown) => console.error('saving the tournament standings failed', e));
    this.broadcast();
  }
}

/** How a tournament game ended, as its room reports it. */
export interface GameEnd {
  readonly gameId: string;
  readonly winner: Color | null;
  readonly plies: number;
}

interface Row {
  id: string;
  name: string;
  variant_id: string;
  time_control_id: string;
  rated: number;
  starts_at: number;
  ends_at: number;
  status: string;
  players: number;
  winner: string | null;
}

function summary(r: Row, now: number): TournamentSummary {
  return {
    id: r.id,
    name: r.name,
    variantId: r.variant_id,
    timeControlId: r.time_control_id,
    rated: r.rated === 1,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    // The table's status can lag behind the clock by an alarm.
    status: now >= r.ends_at ? 'finished' : now >= r.starts_at ? 'started' : 'created',
    players: r.players,
    winner: r.winner,
  };
}

/** Answers a tournament request, or returns null when `url` is not one. */
export async function handleTournaments(request: Request, env: Env, url: URL): Promise<Response | null> {
  const m = /^\/api\/tournaments(?:\/([^/]+)(\/ws)?)?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return json({ error: 'accounts-off' }, 503);
  const now = Date.now();

  if (m[1]) {
    if (!ID.test(m[1])) return json({ error: 'not-found' }, 404);
    const stub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(m[1]));
    if (m[2]) {
      const user = await currentUser(request, env).catch(() => null);
      return stub.fetch(withAccountHeaders(request, user));
    }
    if (request.method !== 'GET') return json({ error: 'not-found' }, 404);
    return stub.fetch('https://tournament/view');
  }

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, name, variant_id, time_control_id, rated, starts_at, ends_at, status, players, winner
       FROM tournaments WHERE ends_at > ?1 ORDER BY starts_at LIMIT 50`,
    )
      .bind(now)
      .all<Row>();
    const done = await env.DB.prepare(
      `SELECT id, name, variant_id, time_control_id, rated, starts_at, ends_at, status, players, winner
       FROM tournaments WHERE ends_at <= ?1 ORDER BY ends_at DESC LIMIT 20`,
    )
      .bind(now)
      .all<Row>();
    const open = rows.results.map((r) => summary(r, now));
    return json({
      live: open.filter((t) => t.status === 'started'),
      upcoming: open.filter((t) => t.status === 'created'),
      finished: done.results.map((r) => summary(r, now)),
    } satisfies TournamentList);
  }

  if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN || url.origin, url)) return json({ error: 'forbidden' }, 403);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return json({ error: 'signed-out' }, 401);
  const body = (await request.json().catch(() => ({}))) as Partial<CreateTournament>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (tournamentNameProblem(name)) return json({ error: 'name' }, 400);
  if (!listVariants().some((v) => v.id === body.variantId)) return json({ error: 'bad-request' }, 400);
  if (!TOURNAMENT_TIME_CONTROLS.includes(String(body.timeControlId))) return json({ error: 'bad-request' }, 400);
  if (!(TOURNAMENT_MINUTES as readonly number[]).includes(Number(body.minutes)))
    return json({ error: 'bad-request' }, 400);
  if (!(TOURNAMENT_START_IN as readonly number[]).includes(Number(body.startIn)))
    return json({ error: 'bad-request' }, 400);
  const open = await env.DB.prepare('SELECT 1 FROM tournaments WHERE owner_id = ?1 AND ends_at > ?2')
    .bind(user.id, now)
    .first();
  if (open) return json({ error: 'one-open' }, 409);

  const id = randomGameId();
  const startsAt = now + Number(body.startIn) * 60_000;
  const meta: TournamentMeta = {
    id,
    name,
    variantId: String(body.variantId),
    timeControlId: String(body.timeControlId),
    rated: body.rated !== false,
    startsAt,
    endsAt: startsAt + Number(body.minutes) * 60_000,
    createdBy: user.username,
  };
  await env.DB.prepare(
    `INSERT INTO tournaments (id, name, owner_id, variant_id, time_control_id, rated, starts_at, ends_at, status, players, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'created', 0, ?9)`,
  )
    .bind(id, name, user.id, meta.variantId, meta.timeControlId, meta.rated ? 1 : 0, startsAt, meta.endsAt, now)
    .run();
  const res = await env.TOURNAMENT.get(env.TOURNAMENT.idFromName(id)).fetch('https://tournament/init', {
    method: 'POST',
    body: JSON.stringify(meta),
  });
  if (!res.ok) return json({ error: 'bad-request' }, 500);
  return json({ id });
}
