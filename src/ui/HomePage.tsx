import { useEffect, useState } from 'react';
import { listVariants } from '../engine/index.ts';
import type { LiveStats } from '../online/lobby.ts';
import { dailyDay, dailyNumber, gridEmoji } from '../online/daily.ts';
import { dailyResults, localStreak } from './DailyPage.tsx';
import type { PieceType, VariantDefinition } from '../engine/index.ts';
import { useI18n } from './i18n.tsx';
import { PieceView } from './PieceView.tsx';
import { Crown } from './Punk.tsx';
import type { GameSettings, Mode } from './settings.ts';

interface Props {
  /** Opens the new game dialog, optionally with some settings already picked. */
  onPlay: (patch?: Partial<GameSettings>) => void;
  /** Opens online play (the lobby): the main way to play. */
  onOnline: () => void;
  /** Opens the daily puzzle. */
  onDaily: () => void;
}

const STANDARD_TYPES = new Set(['k', 'q', 'r', 'b', 'n', 'p']);
/** The piece that shows a variant on its card: its own special piece, else the king. */
const signature = (v: VariantDefinition): PieceType => v.pieceTypes.find((type) => !STANDARD_TYPES.has(type)) ?? 'k';

/** Ways to play on this device, after online play: the computer, bots, two players. */
const OPPONENTS: { mode: Mode; sub: 'home.hotseatSub' | 'home.botSub' | 'home.botvbotSub' }[] = [
  { mode: 'bot', sub: 'home.botSub' },
  { mode: 'botvbot', sub: 'home.botvbotSub' },
  { mode: 'hotseat', sub: 'home.hotseatSub' },
];

/** What is going on right now, asked again every half minute while the page is open. */
function useLiveStats(): LiveStats | null {
  const [stats, setStats] = useState<LiveStats | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      fetch('/api/stats')
        .then((r) => (r.ok ? (r.json() as Promise<LiveStats>) : null))
        .then((s) => live && s && setStats(s))
        .catch(() => {});
    void ask();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void ask();
    }, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return stats;
}

function Arrow() {
  return (
    <svg className="ic arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h16M14 6l6 6-6 6" />
    </svg>
  );
}

/** Landing page: hero, the variants and the ways to play. */
export function HomePage({ onPlay, onOnline, onDaily }: Props) {
  const { t, vt } = useI18n();
  const today = dailyDay(Date.now());
  const done = dailyResults()[today];
  const streak = localStreak(today);
  const stats = useLiveStats();
  return (
    <div className="home">
      <section className="hero">
        <img className="hero-image" src={`${import.meta.env.BASE_URL}hero.webp`} alt={t('home.heroAlt')} />
        <div className="hero-copy">
          <h1 className="sr-only">punkchess</h1>
          <p className="tape">
            <span>{t('home.tape1')}</span>
            <span>{t('home.tape2')}</span>
          </p>
          <p className="lede">
            {t('home.lede')
              .split(/(?<=\.)\s+/)
              .map((sentence) => (
                <span key={sentence}>{sentence}</span>
              ))}
          </p>
          <div className="ctas">
            <button className="cta" onClick={onOnline}>
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                <path className="fill" d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
              {t('home.play')}
              <Arrow />
            </button>
            <a className="cta ghost" href="#variants">
              {t('home.explore')}
            </a>
          </div>
          <button className="daily-box" onClick={onDaily}>
            <span className="daily-box-title">
              {t('daily.title')} <b>#{dailyNumber(today)}</b>
            </span>
            <span className="daily-box-sub">
              {done ? gridEmoji(done) : t('daily.homeCta')}
              {streak > 0 && <span className="daily-box-streak">🔥 {streak}</span>}
            </span>
            <Arrow />
          </button>
          {stats && (
            <p className="live-stats">
              <span className="live-dot" aria-hidden="true" />
              {t('home.liveGames', { n: String(stats.games) })} · {t('home.livePlayers', { n: String(stats.players) })}
            </p>
          )}
          <ul className="facts">
            <li>{t('home.fact1')}</li>
            <li>{t('home.fact2')}</li>
            <li>{t('home.fact3')}</li>
          </ul>
        </div>
        <p className="slogan" aria-hidden="true">
          {t('home.slogan1')}
          <br />
          {t('home.slogan2')}
          <br />
          {t('home.slogan3')}
          <Crown />
        </p>
      </section>

      <section className="home-cards" id="variants" aria-label={t('home.variants')}>
        {listVariants().map((v, i) => {
          const texts = vt(v);
          return (
            <button
              key={v.id}
              className={`variant-card${i % 2 ? ' lime' : ''}`}
              onClick={() => onPlay({ variantId: v.id })}
            >
              <span className="variant-icon">
                <PieceView variant={v} piece={{ type: signature(v), color: i % 2 ? 'w' : 'b' }} />
              </span>
              <span className="variant-text">
                <span className="variant-name">{texts.name}</span>
                <span className="variant-summary">{texts.rules.summary}</span>
              </span>
              <Arrow />
            </button>
          );
        })}
        <div className="opponents">
          <h2>
            <Crown />
            {t('home.opponents')}
          </h2>
          <button className="opponent" onClick={onOnline}>
            <b>1</b>
            <span>
              {t('online.title')}
              <small>{t('home.onlineSub')}</small>
            </span>
          </button>
          {OPPONENTS.map((o, i) => (
            <button key={o.mode} className="opponent" onClick={() => onPlay({ mode: o.mode })}>
              <b>{i + 2}</b>
              <span>
                {t(`mode.${o.mode}`)}
                <small>{t(o.sub)}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <footer className="home-footer">
        <a href="/privacy">{t('legal.privacy')}</a>
        <a href="/terms">{t('legal.terms')}</a>
      </footer>
    </div>
  );
}
