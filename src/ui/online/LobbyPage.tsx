import { useState } from 'react';
import { TIME_CONTROLS, timeControl } from '../../clock/clock.ts';
import { getVariant, listVariants } from '../../engine/index.ts';
import type { Color } from '../../engine/index.ts';
import { quickTimeControls } from '../../online/lobby.ts';
import type { Seek } from '../../online/lobby.ts';
import type { MessageKey } from '../../i18n/index.ts';
import { useI18n } from '../i18n.tsx';
import type { Mode } from '../settings.ts';
import { ApiError, createOnlineGame, loadName, saveName } from './connection.ts';
import { playerIdentity, useLobby } from './lobbyConnection.ts';
import { useAccount } from '../account.ts';
import type { ChallengeRequest } from '../../online/challenge.ts';
import { ProfileLink } from '../ProfileLink.tsx';
import { FollowStrip } from '../FollowStrip.tsx';

type Tab = 'quick' | 'seeks' | 'friend';

/** Lichess-style speed of a time control, from its estimated length (start + 40 increments). */
function speedOf(timeControlId: string): 'bullet' | 'blitz' | 'rapid' | 'classical' {
  const tc = timeControl(timeControlId);
  const seconds = ((tc.initialMs ?? 0) + 40 * tc.incrementMs) / 1000;
  if (seconds < 180) return 'bullet';
  if (seconds < 480) return 'blitz';
  if (seconds < 1500) return 'rapid';
  return 'classical';
}

const BOLT = (
  <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </svg>
);

/**
 * /online: quick pairing (standard chess by time control), the lobby of open
 * games, and a private game to send to a friend by link.
 */
export function LobbyPage({
  onOpenGame,
  defaultVariantId,
  onPlayOffline,
  onResumeGame,
}: {
  onOpenGame: (id: string) => void;
  defaultVariantId: string;
  onPlayOffline: (mode: Mode) => void;
  onResumeGame: (() => void) | null;
}) {
  const { t } = useI18n();
  const lobby = useLobby((ticket) => onOpenGame(ticket.gameId));
  return (
    <main className="online-lobby">
      <LobbyCard lobby={lobby} onOpenGame={onOpenGame} defaultVariantId={defaultVariantId} />

      <section className="offline-play" aria-labelledby="offline-title">
        <h2 id="offline-title">{t('lobby.offline')}</h2>
        <div className="offline-buttons">
          {onResumeGame && (
            <button className="primary" onClick={onResumeGame}>
              {t('lobby.resume')}
            </button>
          )}
          {(['bot', 'botvbot', 'hotseat'] as const).map((mode) => (
            <button key={mode} onClick={() => onPlayOffline(mode)} title={t(`mode.${mode}`)}>
              {t(`mode.${mode}Short`)}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

/** The lobby: quick pairing, open games, a game for a friend. On /online and the home page. */
export function LobbyCard({
  lobby,
  onOpenGame,
  defaultVariantId,
}: {
  lobby: Lobby;
  onOpenGame: (id: string) => void;
  defaultVariantId: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('quick');
  const [name, setName] = useState(() => playerIdentity().name);
  const account = useAccount();
  const mine = lobby.seeks.find((s) => s.id === lobby.mySeek) ?? null;

  const saveNickname = () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) return setName(loadName());
    if (clean !== loadName()) lobby.rename(clean);
  };

  return (
    <section className="online-card lobby-card">
      <div className="lobby-head">
        <div className="lobby-title">
          <div className="analysis-head">
            {BOLT}
            <h1>{t('online.title')}</h1>
          </div>
          <span className={`lobby-online${lobby.status === 'open' ? '' : ' off'}`}>
            {lobby.status === 'open' ? t('lobby.online', { n: String(lobby.online) }) : t('lobby.reconnecting')}
          </span>
          <FollowStrip onOpenGame={onOpenGame} />
        </div>

        {account.user ? (
          <div className="analysis-field lobby-name">
            <span>{t('signup.username')}</span>
            <strong className="lobby-username">{account.user.username}</strong>
          </div>
        ) : (
          <label className="analysis-field lobby-name">
            <span>{t('online.name')}</span>
            <input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveNickname}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              autoComplete="nickname"
            />
          </label>
        )}
      </div>

      <div className="lobby-tabs" role="tablist">
        {(['quick', 'seeks', 'friend'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {t(`lobby.tab.${id}`)}
            {id === 'seeks' && lobby.seeks.length > 0 && <span className="lobby-count">{lobby.seeks.length}</span>}
          </button>
        ))}
      </div>

      {lobby.error && <p className="error">{t(`lobby.error.${lobby.error}`)}</p>}

      {tab === 'quick' && <QuickPairing mine={mine} lobby={lobby} />}
      {tab === 'seeks' && <SeekList mine={mine} lobby={lobby} defaultVariantId={defaultVariantId} />}
      {tab === 'friend' && <FriendGame onOpenGame={onOpenGame} defaultVariantId={defaultVariantId} />}
    </section>
  );
}

export type Lobby = ReturnType<typeof useLobby>;

function QuickPairing({ mine, lobby }: { mine: Seek | null; lobby: Lobby }) {
  const { t } = useI18n();
  const controls = quickTimeControls(TIME_CONTROLS.map((tc) => tc.id));
  return (
    <div className="lobby-panel">
      <div className="lobby-scroll">
        <p className="muted online-lede">{t('lobby.quickHint')}</p>
        <div className="quick-grid">
          {controls.map((id) => {
            const searching = mine?.quick === true && mine.timeControlId === id;
            return (
              <button
                key={id}
                className={`quick-tile${searching ? ' on' : ''}`}
                disabled={lobby.status !== 'open'}
                onClick={() => (searching ? lobby.cancel() : lobby.quick(id))}
              >
                <span className="quick-time">{timeControl(id).label}</span>
                <span className="quick-speed">
                  {searching ? t('lobby.searching') : t(`lobby.speed.${speedOf(id)}`)}
                </span>
                {searching && <span className="quick-cancel">{t('lobby.cancel')}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SeekList({
  mine,
  lobby,
  defaultVariantId,
  startPosting = false,
}: {
  mine: Seek | null;
  lobby: Lobby;
  defaultVariantId: string;
  /** Opens on the form to post a game (the home page's variant dialog). */
  startPosting?: boolean;
}) {
  const { t, vt } = useI18n();
  const me = playerIdentity().id;
  const account = useAccount();
  // Signed-in players post rated games by default.
  const [rated, setRated] = useState(true);
  const [variantId, setVariantId] = useState(defaultVariantId);
  const [timeControlId, setTimeControlId] = useState('5+0');
  const [color, setColor] = useState<Color | 'random'>('random');
  // The list of open games, or the form to post one: shown one at a time so both fit the screen.
  const [posting, setPosting] = useState(startPosting);
  const colorLabel = (c: Color | 'random') => (c === 'random' ? t('online.random') : t(`color.${c}`));
  const waiting = !!mine && !mine.quick;

  return (
    <div className="lobby-panel">
      <div className="lobby-scroll">
        {!posting && (
          <div className="seek-table" role="table" aria-label={t('lobby.tab.seeks')}>
            <div className="seek-row head" role="row">
              <span role="columnheader">{t('lobby.player')}</span>
              <span role="columnheader">{t('lobby.variant')}</span>
              <span role="columnheader">{t('lobby.time')}</span>
              <span role="columnheader">{t('lobby.color')}</span>
            </div>
            {lobby.seeks.length === 0 && <p className="muted seek-empty">{t('lobby.empty')}</p>}
            {lobby.seeks.map((s) => {
              const own = s.id === lobby.mySeek || s.player.id === me;
              const joinable = !own && lobby.status === 'open' && !(s.rated && !account.user);
              const player = own ? `${s.player.name} · ${t('lobby.you')}` : s.player.name;
              // The name links to the profile; the rest of the row takes the offer.
              return (
                <div key={s.id} role="row" className={`seek-row${own ? ' own' : ''}`}>
                  <span role="cell" className="seek-player">
                    {s.player.account && !own ? <ProfileLink username={s.player.name}>{player}</ProfileLink> : player}
                    {s.player.rating !== null && (
                      <span className="seek-rating">
                        {s.player.rating}
                        {s.player.provisional ? '?' : ''}
                      </span>
                    )}
                    {s.rated && <span className="rated-tag">{t('lobby.rated')}</span>}
                  </span>
                  <button
                    className="seek-join"
                    disabled={!joinable}
                    onClick={() => lobby.accept(s.id)}
                    title={own ? undefined : s.rated && !account.user ? t('lobby.ratedSignIn') : t('lobby.join')}
                  >
                    <span role="cell">{vt(getVariant(s.variantId)).name}</span>
                    <span role="cell">
                      {timeControl(s.timeControlId).initialMs === null
                        ? t('time.none')
                        : timeControl(s.timeControlId).label}
                    </span>
                    <span role="cell">
                      <span className={`seek-color ${s.color}`} aria-hidden="true" />
                      {colorLabel(s.color)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {waiting && <p className="muted seek-mine">{t('lobby.waiting')}</p>}
        {posting && !waiting && (
          <form
            id="seek-form"
            className="seek-form"
            onSubmit={(e) => {
              e.preventDefault();
              lobby.seek({ variantId, timeControlId, color, rated: !!account.user && rated });
              setPosting(false);
            }}
          >
            <fieldset className="choice-row choice-grid">
              <legend>{t('newGame.variant')}</legend>
              {listVariants().map((v) => (
                <label key={v.id} className={`chip${variantId === v.id ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="seek-variant"
                    checked={variantId === v.id}
                    onChange={() => setVariantId(v.id)}
                  />
                  {vt(v).name}
                </label>
              ))}
            </fieldset>
            <fieldset className="choice-row choice-grid time">
              <legend>{t('newGame.time')}</legend>
              {TIME_CONTROLS.map((tc) => (
                <label key={tc.id} className={`chip${timeControlId === tc.id ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="seek-time"
                    checked={timeControlId === tc.id}
                    onChange={() => setTimeControlId(tc.id)}
                  />
                  {tc.initialMs === null ? t('time.none') : tc.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="choice-row choice-grid colors">
              <legend>{t('online.color')}</legend>
              {(['w', 'random', 'b'] as const).map((c) => (
                <label key={c} className={`chip${color === c ? ' on' : ''}`}>
                  <input type="radio" name="seek-color" checked={color === c} onChange={() => setColor(c)} />
                  {colorLabel(c)}
                </label>
              ))}
            </fieldset>
            {account.user && (
              <fieldset className="choice-row choice-grid rated">
                <legend>{t('lobby.kind')}</legend>
                {([true, false] as const).map((r) => (
                  <label key={String(r)} className={`chip${rated === r ? ' on' : ''}`}>
                    <input type="radio" name="seek-rated" checked={rated === r} onChange={() => setRated(r)} />
                    {t(r ? 'lobby.rated' : 'lobby.casual')}
                  </label>
                ))}
              </fieldset>
            )}
          </form>
        )}
      </div>
      <div className={`lobby-actions${posting && !waiting ? ' pair' : ''}`}>
        {waiting ? (
          <button onClick={lobby.cancel}>{t('lobby.removeSeek')}</button>
        ) : posting ? (
          <>
            <button type="button" onClick={() => setPosting(false)}>
              {t('settings.back')}
            </button>
            <button type="submit" form="seek-form" className="primary analysis-go" disabled={lobby.status !== 'open'}>
              {t('lobby.newSeek')}
            </button>
          </>
        ) : (
          <button type="button" className="primary analysis-go" onClick={() => setPosting(true)}>
            {t('lobby.newSeek')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A private game: made here, started when the friend opens the link. */
/**
 * A game for a friend: made here, then its link is sent. With `challenge`, the
 * game is for that player, who is told about it on the site.
 */
export function FriendGame({
  onOpenGame,
  defaultVariantId,
  challenge,
}: {
  onOpenGame: (id: string) => void;
  defaultVariantId: string;
  /** Username of the challenged player. */
  challenge?: string;
}) {
  const { t, vt } = useI18n();
  const account = useAccount();
  const [rated, setRated] = useState(true);
  const [variantId, setVariantId] = useState(defaultVariantId);
  const [timeControlId, setTimeControlId] = useState('5+0');
  const [color, setColor] = useState<Color | 'random'>('random');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = account.user?.username ?? (loadName() || t('online.anon'));
      saveName(name);
      const ticket = await createOnlineGame({
        variantId,
        timeControlId,
        color,
        name,
        rated: !!account.user && rated,
      });
      if (challenge) {
        const body: ChallengeRequest = {
          to: challenge,
          gameId: ticket.gameId,
          variantId,
          timeControlId,
          rated: !!account.user && rated,
        };
        const res = await fetch('/api/challenges', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new ApiError('network');
      }
      onOpenGame(ticket.gameId);
    } catch (e) {
      setError(e instanceof ApiError && e.code !== 'network' ? 'online.error.create' : 'online.error.network');
      setBusy(false);
    }
  };

  return (
    <form
      className="lobby-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="lobby-scroll">
        <p className="muted online-lede">{challenge ? t('challenge.lede', { name: challenge }) : t('online.lede')}</p>
        <fieldset className="choice-row choice-grid">
          <legend>{t('newGame.variant')}</legend>
          {listVariants().map((v) => (
            <label key={v.id} className={`chip${variantId === v.id ? ' on' : ''}`}>
              <input
                type="radio"
                name="online-variant"
                checked={variantId === v.id}
                onChange={() => setVariantId(v.id)}
              />
              {vt(v).name}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice-row choice-grid time">
          <legend>{t('newGame.time')}</legend>
          {TIME_CONTROLS.map((tc) => (
            <label key={tc.id} className={`chip${timeControlId === tc.id ? ' on' : ''}`}>
              <input
                type="radio"
                name="online-time"
                checked={timeControlId === tc.id}
                onChange={() => setTimeControlId(tc.id)}
              />
              {tc.initialMs === null ? t('time.none') : tc.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice-row choice-grid colors">
          <legend>{t('online.color')}</legend>
          {(['w', 'random', 'b'] as const).map((c) => (
            <label key={c} className={`chip${color === c ? ' on' : ''}`}>
              <input type="radio" name="online-color" checked={color === c} onChange={() => setColor(c)} />
              {c === 'random' ? t('online.random') : t(`color.${c}`)}
            </label>
          ))}
        </fieldset>
        {account.user && (
          <fieldset className="choice-row choice-grid rated">
            <legend>{t('lobby.kind')}</legend>
            {([true, false] as const).map((r) => (
              <label key={String(r)} className={`chip${rated === r ? ' on' : ''}`}>
                <input type="radio" name="friend-rated" checked={rated === r} onChange={() => setRated(r)} />
                {t(r ? 'lobby.rated' : 'lobby.casual')}
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="error">{t(error)}</p>}
      </div>
      <div className="lobby-actions">
        <button type="submit" className="primary analysis-go" disabled={busy}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path className="fill" d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          {busy ? t('online.creating') : challenge ? t('challenge.send') : t('online.create')}
        </button>
      </div>
    </form>
  );
}
