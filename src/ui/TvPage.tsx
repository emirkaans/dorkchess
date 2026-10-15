import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { timeControl } from '../clock/clock.ts';
import type { ClockState } from '../clock/clock.ts';
import { createGame, findMove, getVariant, makeMove } from '../engine/index.ts';
import type { Color, GameState } from '../engine/index.ts';
import type { LiveGame, TvResponse } from '../online/lobby.ts';
import type { GameView } from '../online/protocol.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';
import { useOnlineGame } from './online/connection.ts';
import { PlayerRow } from './PlayerRow.tsx';
import { ProfileLink } from './ProfileLink.tsx';

const HUMAN = { kind: 'human' } as const;
/** After a game ends, TV stays on it this long, then moves to another. */
const NEXT_AFTER_MS = 6000;
/** With nothing to show, TV asks again this often. */
const RETRY_MS = 15000;

function lastState(view: GameView): GameState | null {
  if (!view.startFen) return null;
  const v = getVariant(view.variantId);
  let s = createGame(v, view.startFen);
  for (const m of view.moves) {
    const move = findMove(v, s, m.from, m.to, m.promotion);
    if (!move) break;
    s = makeMove(v, s, move);
  }
  return s;
}

function clockOf(view: GameView, offset: number): ClockState {
  const r = view.clock.remaining;
  return {
    control: timeControl(view.timeControlId),
    remaining: { w: r.w ?? Infinity, b: r.b ?? Infinity },
    running: view.phase === 'playing' ? view.clock.running : null,
    since: view.clock.since + offset,
    stopped: view.phase === 'over',
  };
}

/** One game on TV: a spectator's view of it, updated live. */
function Screen({ game, onOver }: { game: LiveGame; onOver: () => void }) {
  const { t, vt } = useI18n();
  const { view, offset } = useOnlineGame(game.id, null);
  const state = useMemo(() => (view ? lastState(view) : null), [view]);
  const over = view?.phase === 'over';
  useEffect(() => {
    if (!over) return;
    const id = setTimeout(onOver, NEXT_AFTER_MS);
    return () => clearTimeout(id);
  }, [over, onOver]);
  if (!view || !state) return <p className="muted">{t('online.connecting')}</p>;
  const variant = getVariant(view.variantId);
  const tc = timeControl(view.timeControlId);
  const timed = tc.initialMs !== null;
  const label = (c: Color) => {
    const p = view.players[c];
    if (!p) return '';
    const name = p.username ? <ProfileLink username={p.username}>{p.name}</ProfileLink> : p.name;
    return (
      <>
        {name}
        {p.rating !== null ? ` · ${p.rating}${p.provisional ? '?' : ''}` : ''}
      </>
    );
  };
  return (
    <div className="tv-screen">
      <p className="tv-meta">
        {vt(variant).name} · {timed ? tc.label : t('time.none')} · {t(view.rated ? 'lobby.rated' : 'lobby.casual')}
        {over && <strong className="tv-over"> · {t('tv.over')}</strong>}
      </p>
      <div
        className="tv-board"
        style={{ '--board': 'min(560px, calc(100vw - 32px), calc(100svh - 330px))' } as CSSProperties}
      >
        <PlayerRow
          variant={variant}
          color="b"
          player={HUMAN}
          position={state.position}
          active={!over && state.position.turn === 'b'}
          clock={timed ? clockOf(view, offset) : null}
          place="top"
          label={label('b')}
        />
        <Board
          variant={variant}
          position={state.position}
          lastMove={state.moves.at(-1)?.move ?? null}
          flipped={false}
          highlight={[]}
          bandRanks={variant.highlight?.ranks ?? []}
          disabled
          onMove={() => {}}
        />
        <PlayerRow
          variant={variant}
          color="w"
          player={HUMAN}
          position={state.position}
          active={!over && state.position.turn === 'w'}
          clock={timed ? clockOf(view, offset) : null}
          place="bottom"
          label={label('w')}
        />
      </div>
    </div>
  );
}

/** /tv: the best online game being played now, live; when it ends, the next one. */
export function TvPage({ onPlay }: { onPlay: () => void }) {
  const { t } = useI18n();
  const [game, setGame] = useState<LiveGame | null | 'loading'>('loading');
  const [ask, setAsk] = useState(0);
  const [skip, setSkip] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/tv${skip ? `?skip=${encodeURIComponent(skip)}` : ''}`)
        .then((r) => (r.ok ? (r.json() as Promise<TvResponse>) : { game: null }))
        .then((d) => live && setGame(d.game))
        .catch(() => live && setGame(null));
    void load();
    return () => {
      live = false;
    };
  }, [ask, skip]);

  // Nothing on: ask again now and then.
  useEffect(() => {
    if (game !== null) return;
    const id = setInterval(() => setAsk((n) => n + 1), RETRY_MS);
    return () => clearInterval(id);
  }, [game]);

  return (
    <main className="tv-page">
      <h1 className="tv-title">
        <span className="live-dot" aria-hidden="true" /> {t('tv.title')}
      </h1>
      {game === 'loading' && <p className="muted">{t('online.connecting')}</p>}
      {game === null && (
        <div className="tv-empty">
          <p>{t('tv.empty')}</p>
          <button className="primary" onClick={onPlay}>
            {t('home.play')}
          </button>
        </div>
      )}
      {game && game !== 'loading' && (
        <Screen
          key={game.id}
          game={game}
          onOver={() => {
            setSkip(game.id);
            setAsk((n) => n + 1);
          }}
        />
      )}
    </main>
  );
}
