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
