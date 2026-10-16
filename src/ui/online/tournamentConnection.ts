// Browser side of a tournament: a hook holding its WebSocket (standings as they
// change). When the tournament pairs this player, the seat ticket is saved like
// a lobby pairing's and the caller opens the game.

import { useEffect, useRef, useState } from 'react';
import type { SeatTicket } from '../../online/protocol.ts';
import type { TournamentClientMessage, TournamentServerMessage, TournamentView } from '../../online/tournament.ts';
import { saveTicket } from './connection.ts';

export interface TournamentLink {
  readonly status: 'connecting' | 'open' | 'closed' | 'missing';
  readonly view: TournamentView | null;
  readonly error: Extract<TournamentServerMessage, { t: 'error' }>['code'] | null;
  /** The server's clock minus this browser's (for the countdowns). */
  readonly skew: number;
  readonly join: () => void;
  readonly withdraw: () => void;
}

const wsUrl = (id: string) =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/tournaments/${id}/ws`;

/** Keeps the tournament's connection open while its page is shown; `onPaired` gets a new game's ticket. */
export function useTournament(id: string, onPaired: (ticket: SeatTicket) => void): TournamentLink {
  const [status, setStatus] = useState<TournamentLink['status']>('connecting');
  const [view, setView] = useState<TournamentView | null>(null);
  const [error, setError] = useState<TournamentLink['error']>(null);
  const [skew, setSkew] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const paired = useRef(onPaired);
  useEffect(() => {
    paired.current = onPaired;
  });

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const open = async () => {
      setStatus('connecting');
      // An unknown tournament: say so instead of retrying the socket.
      const res = await fetch(`/api/tournaments/${id}`).catch(() => null);
      if (closed) return;
      if (res?.status === 404) return setStatus('missing');
      const ws = new WebSocket(wsUrl(id));
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' } satisfies TournamentClientMessage)), 25_000);
      };
      ws.onmessage = (e) => {
        let msg: TournamentServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as TournamentServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'state') {
          setView(msg.view);
          setSkew(msg.view.now - Date.now());
        } else if (msg.t === 'paired') {
          saveTicket(msg.ticket);
          paired.current(msg.ticket);
        } else if (msg.t === 'ticket') {
          // A game of ours going on (paired while we were away): its seat, for "back to your game".
          saveTicket(msg.ticket);
        } else if (msg.t === 'error') {
          const code = msg.code;
          setError(code);
          setTimeout(() => setError((c) => (c === code ? null : c)), 4000);
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (socket.current === ws) socket.current = null;
        if (closed) return;
        setStatus('closed');
        timer = setTimeout(() => void open(), Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    void open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      socket.current?.close();
    };
  }, [id]);

  const send = (msg: TournamentClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  return {
    status,
    view,
    error,
    skew,
    join: () => send({ t: 'join' }),
    withdraw: () => send({ t: 'withdraw' }),
  };
}
