import { useEffect, useRef, useState } from 'react';
import {
  dailyDay,
  dailyNumber,
  dailyShareText,
  gridEmoji,
  gridSolved,
  nextDailyAt,
  streakOf,
} from '../online/daily.ts';
import type { DailyResponse, DailySaved } from '../online/daily.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';
import { useAccount } from './account.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';
import { usePuzzleRunner } from './puzzleRunner.ts';
import type { Prefs } from './prefs.ts';

/** This browser's daily results: day → grid. Signed-in players' are also on the server. */
const RESULTS_KEY = 'daily:results';

export const dailyResults = (): Record<string, string> => loadJSON<Record<string, string>>(RESULTS_KEY, {});

/** This browser's streak (a guest's only one). */
export const localStreak = (today: string): number =>
  streakOf(
    Object.entries(dailyResults())
      .filter(([, grid]) => gridSolved(grid))
      .map(([day]) => day),
    today,
  );

function saveLocal(day: string, grid: string) {
  const all = dailyResults();
  if (all[day]) return;
  saveJSON(RESULTS_KEY, { ...all, [day]: grid });
}

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * /daily: "Günün sabotajı", the same puzzle for everyone today. Every move of
 * the player's is a square of the grid; the grid and the streak can be shared.
 * It does not change the puzzle rating.
 */
export function DailyPage({ prefs }: { prefs: Prefs }) {
  const { t } = useI18n();
  const account = useAccount();
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [grid, setGrid] = useState('');
  const [streak, setStreak] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  // The current move was missed at least once.
  const missed = useRef(false);
  const gridRef = useRef('');
  const push = (squares: string) => {
    gridRef.current += squares;
    setGrid(gridRef.current);
  };

  const finish = (final: string) => {
    if (!daily) return;
    saveLocal(daily.day, final);
    setStreak(localStreak(daily.day));
    if (account.user) {
      void fetch('/api/daily/result', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grid: final, day: daily.day }),
      })
        .then((res) => (res.ok ? (res.json() as Promise<DailySaved>) : null))
        .then((r) => r && setStreak(r.streak))
        .catch(() => {});
    }
  };

  const run = usePuzzleRunner(prefs.sound, {
    onWrong: () => {
      missed.current = true;
    },
    onCorrect: () => {
      push(missed.current ? 'm' : 'h');
      missed.current = false;
    },
    onSolved: () => finish(gridRef.current),
    onShown: (left) => {
      push('s'.repeat(left));
      finish(gridRef.current);
    },
  });
  const { puzzle, state, status, setStatus, variant, you, over } = run;

  useEffect(() => {
    if (account.loading) return;
    let live = true;
    fetch('/api/daily', { credentials: 'same-origin' })
      .then((res) => res.json() as Promise<DailyResponse>)
      .then((d) => {
        if (!live) return;
        setDaily(d);
        if (!d.puzzle) return setStatus('empty');
        // Played already: on the account, or in this browser.
        const done = d.result?.grid ?? dailyResults()[d.day];
        if (d.result) saveLocal(d.day, d.result.grid);
        setStreak(account.user ? d.streak : localStreak(d.day));
        gridRef.current = done ?? '';
        setGrid(gridRef.current);
        missed.current = false;
        run.start(d.puzzle, done ? (gridSolved(done) ? 'solved' : 'shown') : undefined);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Once the player is known; the runner's functions change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.loading, account.user]);

  // The countdown to the next puzzle.
  useEffect(() => {
    if (!over) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [over]);
  // Past midnight the page is yesterday's: it says so instead of counting down.
  const stale = daily !== null && dailyDay(now) !== daily.day;

  const share = async () => {
    if (!daily) return;
    const text = dailyShareText(daily.number, grid, streak, `${location.origin}/daily`);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // cancelled, or not allowed: copy instead
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard either
    }
  };

  let line: string;
  if (failed || status === 'empty') line = t('puzzle.empty');
  else if (status === 'loading' || status === 'opponent' || !puzzle) line = t('puzzle.loading');
  else if (status === 'wrong') line = t('puzzle.wrong');
  else if (status === 'solved') line = t('puzzle.solved');
  else if (status === 'shown') line = t('puzzle.shown');
  else line = t('puzzle.yourMove', { color: t(`color.${you}`) });

  const number = daily?.number ?? dailyNumber(dailyDay(now));
  return (
    <main className="analysis-page puzzle-page daily-page">
      <div className="analysis-board">
        <div className="analysis-board-inner">
          {state && (
            <Board
              variant={variant}
              position={state.position}
              lastMove={state.moves.at(-1)?.move ?? null}
              flipped={you === 'b'}
              highlight={run.hintSquares}
              bandRanks={[]}
              disabled={status !== 'play'}
              onMove={run.onMove}
            />
          )}
        </div>
      </div>

      <aside className="analysis-side puzzle-side">
        <div className="analysis-head">
          <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <h1>
            {t('daily.title')} <span className="daily-number">#{number}</span>
          </h1>
        </div>

        <div className={`puzzle-status ${status}`} role="status">
          {line}
        </div>

        <p className="daily-grid" aria-label={t('daily.gridLabel')}>
          {grid ? gridEmoji(grid) : <span className="muted">{t('daily.gridEmpty')}</span>}
        </p>

        {!over && (
          <div className="puzzle-actions">
            <button
              disabled={status !== 'play'}
              onClick={() => {
                // A move found with a hint is not found at once.
                missed.current = true;
                run.showHint();
              }}
            >
              {t('puzzle.hint')}
            </button>
            <button disabled={!puzzle || status === 'loading' || status === 'opponent'} onClick={run.showSolution}>
              {t('puzzle.solution')}
            </button>
          </div>
        )}

        {over && daily && (
          <div className="daily-done">
            <p className="daily-streak">
              <strong>🔥 {streak}</strong> {t('daily.streak')}
            </p>
            <button className="primary analysis-go" onClick={share}>
              {copied ? t('daily.copied') : t('daily.share')}
            </button>
            <p className="muted daily-next">
              {stale ? t('daily.newOne') : t('daily.next', { time: countdown(nextDailyAt(now) - now) })}
            </p>
          </div>
        )}

        <p className="muted puzzle-note">{t(account.user ? 'daily.note' : 'daily.guestNote')}</p>
        <p className="muted puzzle-credit">{t('puzzle.credit')}</p>
      </aside>
    </main>
  );
}
