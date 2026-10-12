// Browser side of the lobby: who this player is, and a hook holding the lobby
// WebSocket (open seeks, quick pairing). When the server pairs this player,
// the seat ticket is saved like a created / joined game's and the caller
// opens the game.

import { useEffect, useRef, useState } from 'react';
import type { Color } from '../../engine/index.ts';
import type { LobbyClientMessage, LobbyErrorCode, LobbyServerMessage, Seek } from '../../online/lobby.ts';
import type { SeatTicket } from '../../online/protocol.ts';
import { loadJSON, saveJSON } from '../../storage/local.ts';
import { loadName, saveName, saveTicket } from './connection.ts';

/**
 * This browser's player: an anonymous id it keeps and a nickname (a random
 * "Punk#1234" until the player picks one). Accounts will replace both.
 */
export function playerIdentity(): { id: string; name: string } {
  let id = loadJSON<string>('player:id', '');
  if (!id) {
    id = crypto.randomUUID();
    saveJSON('player:id', id);
  }
  let name = loadName();
  if (!name) {
    name = `Punk#${String(Math.floor(1000 + Math.random() * 9000))}`;
    saveName(name);
  }
  return { id, name };
}

export interface LobbyLink {
  readonly status: 'connecting' | 'open' | 'closed';
  readonly seeks: readonly Seek[];
  readonly online: number;
  readonly mySeek: string | null;
  readonly error: LobbyErrorCode | null;
  readonly seek: (req: { variantId: string; timeControlId: string; color: Color | 'random'; rated?: boolean }) => void;
  readonly quick: (timeControlId: string) => void;
  readonly cancel: () => void;
  readonly accept: (seekId: string) => void;
  readonly rename: (name: string) => void;
}

const wsUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/lobby/ws`;

/** Keeps the lobby connection open while the lobby is shown; `onPaired` gets the new game's ticket. */
export function useLobby(onPaired: (ticket: SeatTicket) => void): LobbyLink {
  const [status, setStatus] = useState<LobbyLink['status']>('connecting');
  const [seeks, setSeeks] = useState<readonly Seek[]>([]);
  const [online, setOnline] = useState(0);
  const [mySeek, setMySeek] = useState<string | null>(null);
  const [error, setError] = useState<LobbyErrorCode | null>(null);
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
    const open = () => {
      setStatus('connecting');
      const ws = new WebSocket(wsUrl());
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        const me = playerIdentity();
        ws.send(JSON.stringify({ t: 'hello', playerId: me.id, name: me.name } satisfies LobbyClientMessage));
        ping = setInterval(() => ws.send(JSON.stringify({ t: 'ping' } satisfies LobbyClientMessage)), 25_000);
      };
      ws.onmessage = (e) => {
        let msg: LobbyServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as LobbyServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'state') {
          setSeeks(msg.seeks);
          setOnline(msg.online);
          setMySeek(msg.mySeek);
        } else if (msg.t === 'paired') {
          saveTicket(msg.ticket);
          paired.current(msg.ticket);
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
        setMySeek(null);
        timer = setTimeout(open, Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      socket.current?.close();
    };
  }, []);

  const send = (msg: LobbyClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  return {
    status,
    seeks,
    online,
    mySeek,
    error,
    seek: (req) => send({ t: 'seek', ...req }),
    quick: (timeControlId) => send({ t: 'quick', timeControlId }),
    cancel: () => send({ t: 'cancel' }),
    accept: (seekId) => send({ t: 'accept', seekId }),
    rename: (name) => {
      saveName(name);
      send({ t: 'name', name });
    },
  };
}
