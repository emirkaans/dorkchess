// Browser side of online games: the HTTP calls that create / join a game,
// the seat tickets kept in localStorage, and a hook holding the game's
// WebSocket (reconnecting with backoff while the page is open).

import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  CreateRequest,
  ErrorCode,
  GameView,
  SeatTicket,
  ServerMessage,
} from '../../online/protocol.ts';
import { loadJSON, saveJSON } from '../../storage/local.ts';
import type { GameInfo, GameRecord, RecordSaved, RecordUpload } from '../../online/record.ts';

const ticketKey = (gameId: string) => `online:${gameId}`;

export const loadTicket = (gameId: string): SeatTicket | null => loadJSON<SeatTicket | null>(ticketKey(gameId), null);
export const saveTicket = (t: SeatTicket) => saveJSON(ticketKey(t.gameId), t);

export const loadName = (): string => loadJSON<string>('online:name', '');
export const saveName = (name: string) => saveJSON('online:name', name);

export class ApiError extends Error {
  constructor(readonly code: ErrorCode | 'network') {
    super(code);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: ErrorCode };
  if (!res.ok) throw new ApiError(data.error ?? 'network');
  return data;
}

export async function createOnlineGame(req: CreateRequest): Promise<SeatTicket> {
  const ticket = await post<SeatTicket>('/api/games', req);
  saveTicket(ticket);
  return ticket;
}

export async function joinOnlineGame(gameId: string, name: string): Promise<SeatTicket> {
  const ticket = await post<SeatTicket>(`/api/games/${gameId}/join`, { name });
  saveTicket(ticket);
  return ticket;
}

export type LinkStatus = 'connecting' | 'open' | 'closed';

export interface OnlineLink {
  readonly view: GameView | null;
  /** Local time minus server time when the last view arrived (to run the clocks locally). */
  readonly offset: number;
  readonly status: LinkStatus;
  readonly error: ErrorCode | null;
  readonly send: (msg: ClientMessage) => void;
}

const wsUrl = (gameId: string) => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/games/${gameId}/ws`;
};

/** Keeps a WebSocket to the game open; a token (seat ticket) makes this tab that player. */
export function useOnlineGame(gameId: string, token: string | null): OnlineLink {
  const [view, setView] = useState<GameView | null>(null);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [error, setError] = useState<ErrorCode | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const open = () => {
      setStatus('connecting');
      const ws = new WebSocket(wsUrl(gameId));
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        ws.send(JSON.stringify({ t: 'hello', token } satisfies ClientMessage));
        // Keeps proxies from dropping an idle connection.
        ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage)), 25_000);
      };
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'view') {
          setOffset(Date.now() - msg.view.now);
          setView(msg.view);
        } else if (msg.t === 'error') {
          const code = msg.code;
          setError(code);
          setTimeout(() => setError((c) => (c === code ? null : c)), 3000);
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (socket.current === ws) socket.current = null;
        if (closed) return;
        setStatus('closed');
        // 0.5 s, 1 s, 2 s, then every 4 s.
        timer = setTimeout(open, Math.min(4000, 500 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      socket.current?.close();
      socket.current = null;
    };
  }, [gameId, token]);

  const send = (msg: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  };
  return { view, offset, status, error, send };
}

// ---------------------------------------------------------------------------
// Game links: what /<id> shows, and uploading local games so their link works anywhere.

/** What the server knows about a game id (null: nothing, or no connection). */
export async function fetchGameInfo(id: string): Promise<GameInfo | null> {
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as GameInfo;
  } catch {
    return null;
  }
}

/** This browser's secret for the local games it uploads (only it may update them). */
function ownerToken(): string {
  let token = loadJSON<string>('owner', '');
  if (token.length < 16) {
    token = crypto.randomUUID();
    saveJSON('owner', token);
  }
  return token;
}

/**
 * Stores a local game on the server and returns how many people follow it
 * (null on failure: offline, …; the game simply has no fresh shared copy).
 * `keepalive` lets the upload finish while the page is being closed.
 */
export async function uploadRecord(id: string, record: GameRecord, keepalive = false): Promise<number | null> {
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(id)}/record`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record, owner: ownerToken() } satisfies RecordUpload),
      keepalive,
    });
    if (!res.ok) return null;
    return ((await res.json()) as Partial<RecordSaved>).watchers ?? 0;
  } catch {
    return null;
  }
}

/**
 * The browser playing a stored local game listens to its own game: the server
 * says how many people follow it, so the moves can go up at once when someone does.
 */
export function useWatcherCount(id: string | null, onCount: (n: number) => void): void {
  const handler = useRef(onCount);
  useEffect(() => {
    handler.current = onCount;
  });
  useEffect(() => {
    if (!id) return;
    let closed = false;
    let retry = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const open = () => {
      const ws = new WebSocket(wsUrl(id));
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        ws.send(JSON.stringify({ t: 'hello', token: ownerToken() } satisfies ClientMessage));
        ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage)), 25_000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as ServerMessage;
          if (msg.t === 'watchers') handler.current(msg.count);
        } catch {
          // ignore a broken message
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (!closed) timer = setTimeout(open, Math.min(30_000, 2000 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      socket?.close();
    };
  }, [id]);
}

/** Asks the running game to upload now (e.g. its link was just copied). */
export const FLUSH_UPLOAD = 'punkchess:flush-upload';
export const requestUpload = () => window.dispatchEvent(new Event(FLUSH_UPLOAD));

/**
 * Follows a stored local game live over a WebSocket: `onRecord` gets the record
 * on connect and after every update. Reconnects while `id` is set.
 */
export function useRecordFeed(id: string | null, onRecord: (r: GameRecord) => void): void {
  const handler = useRef(onRecord);
  useEffect(() => {
    handler.current = onRecord;
  });
  useEffect(() => {
    if (!id) return;
    let closed = false;
    let retry = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const open = () => {
      const ws = new WebSocket(wsUrl(id));
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        ws.send(JSON.stringify({ t: 'hello', token: null } satisfies ClientMessage));
        ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMessage)), 25_000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as ServerMessage;
          if (msg.t === 'record') handler.current(msg.record);
        } catch {
          // ignore a broken message
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (!closed) timer = setTimeout(open, Math.min(8000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      socket?.close();
    };
  }, [id]);
}
