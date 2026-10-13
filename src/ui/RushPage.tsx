import { useEffect, useRef, useState } from 'react';
import { RUSH_LIVES, RUSH_MS } from '../online/puzzle.ts';
import type { PuzzleData, RushResponse, RushSaved } from '../online/puzzle.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';
import { useAccount } from './account.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';
import { NewPatches } from './NewPatches.tsx';
import { usePuzzleRunner } from './puzzleRunner.ts';
import type { Prefs } from './prefs.ts';

/** A guest's best score, in this browser. */
const BEST_KEY = 'rush:best';

type Phase = 'ready' | 'loading' | 'running' | 'over';

const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * /rush: Puzzle Rush. Three minutes, the puzzles getting harder; a wrong move
 * fails the puzzle and three fails end the run. It does not change the puzzle rating.
 */
export function RushPage({ prefs }: { prefs: Prefs }) {
  const { t } = useI18n();
  const account = useAccount();
  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  // Each puzzle of the run: solved or failed, in order.
  const [marks, setMarks] = useState<boolean[]>([]);
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [patches, setPatches] = useState<readonly string[]>([]);
  const [newBest, setNewBest] = useState(false);
  const queue = useRef<readonly PuzzleData[]>([]);
  const index = useRef(0);
  // A puzzle counts once (a wrong move fails it and the next one comes).
  const counted = useRef(false);

  const signedIn = !account.loading && !!account.user;
  useEffect(() => {
    if (account.loading) return;
    if (!account.user) return setBest(loadJSON<number>(BEST_KEY, 0));
    // The best score comes with a run's puzzles; ask for it now without starting one.
    setBest(null);
  }, [account.loading, account.user]);

  const finish = (final: number) => {
    setPhase('over');
    if (account.user) {
      void fetch('/api/rush/result', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: final }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<RushSaved>) : null))
        .then((r) => {
          if (!r) return;
          setNewBest(final > 0 && r.best === final && (best ?? 0) < final);
          setBest(r.best);
          setPatches(r.newPatches);
        })
        .catch(() => {});
    } else {
      const old = loadJSON<number>(BEST_KEY, 0);
      if (final > old) saveJSON(BEST_KEY, final);
      setNewBest(final > old);
      setBest(Math.max(old, final));
    }
  };

  const nextPuzzle = (solved: boolean, s: number, m: number) => {
    setMarks((old) => [...old, solved]);
    if (m >= RUSH_LIVES) return finish(s);
    index.current++;
    const p = queue.current[index.current];
    if (!p) return finish(s);
    counted.current = false;
    // A beat to see the move, then the next puzzle.
    setTimeout(() => run.start(p, undefined, 300), solved ? 250 : 600);
  };

  const run = usePuzzleRunner(prefs.sound, {
    onWrong: () => {
      if (counted.current) return;
      counted.current = true;
      const m = misses + 1;
      setMisses(m);
      nextPuzzle(false, score, m);
    },
    onSolved: () => {
      if (counted.current) return;
      counted.current = true;
      const s = score + 1;
      setScore(s);
      nextPuzzle(true, s, misses);
    },
  });
  const { state, status, variant, you } = run;

  const begin = async () => {
    setPhase('loading');
    const d = (await fetch('/api/rush', { credentials: 'same-origin' })
      .then((r) => r.json())
      .catch(() => null)) as RushResponse | null;
    if (!d?.puzzles.length) return setPhase('ready');
    if (d.best !== null) setBest(d.best);
    queue.current = d.puzzles;
    index.current = 0;
    counted.current = false;
    setScore(0);
    setMisses(0);
    setMarks([]);
    setPatches([]);
    setNewBest(false);
    setEndsAt(Date.now() + RUSH_MS);
    setNow(Date.now());
    setPhase('running');
    run.start(d.puzzles[0], undefined, 400);
  };

  // The clock.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);
  const left = endsAt - now;
  useEffect(() => {
    if (phase === 'running' && left <= 0) finish(score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, left <= 0]);

  const running = phase === 'running';
  return (
    <main className="analysis-page puzzle-page rush-page">
      <div className="analysis-board">
        <div className="analysis-board-inner">
          {state ? (
            <Board
              variant={variant}
              position={state.position}
              lastMove={state.moves.at(-1)?.move ?? null}
              flipped={you === 'b'}
              highlight={[]}
              bandRanks={[]}
              disabled={!running || status !== 'play'}
              onMove={run.onMove}
            />
          ) : (
            <div className="rush-splash" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      <aside className="analysis-side puzzle-side">
        <div className="analysis-head">
          <svg className="bolt" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
          </svg>
          <h1>{t('rush.title')}</h1>
        </div>

        {(running || phase === 'over') && (
          <div className="rush-bar">
            <span className={`rush-clock${running && left < 20_000 ? ' low' : ''}`} role="timer">
              {clockText(running ? left : 0)}
            </span>
            <span className="rush-score" aria-label={t('rush.score')}>
              {score}
            </span>
            <span className="rush-lives" aria-label={t('rush.misses', { n: String(misses) })}>
              {Array.from({ length: RUSH_LIVES }, (_, i) => (
                <span key={i} className={i < misses ? 'lost' : ''}>
                  ✖
                </span>
              ))}
            </span>
          </div>
        )}

        {running && (
          <div className={`puzzle-status ${status}`} role="status">
            {status === 'wrong' ? t('rush.miss') : t('puzzle.yourMove', { color: t(`color.${you}`) })}
          </div>
        )}

        {marks.length > 0 && (
          <p className="rush-marks" aria-hidden="true">
            {marks.map((ok, i) => (
              <span key={i} className={ok ? 'ok' : 'bad'} />
            ))}
          </p>
        )}

        {phase === 'over' && (
          <div className="rush-over">
            <p className="rush-final">
              {t('rush.final', { n: String(score) })}
              {newBest && <span className="rush-best-tag">{t('rush.newBest')}</span>}
            </p>
            <NewPatches ids={patches} />
          </div>
        )}

        {!running && (
          <>
            {phase !== 'over' && <p className="rush-rules">{t('rush.rules')}</p>}
            <button className="primary analysis-go" disabled={phase === 'loading'} onClick={() => void begin()}>
              {phase === 'over' ? t('rush.again') : t('rush.start')}
            </button>
            {best !== null && (
              <p className="puzzle-rating">
                {t(signedIn ? 'rush.best' : 'rush.bestGuest')} <strong>{best}</strong>
              </p>
            )}
          </>
        )}

        <p className="muted puzzle-credit">{t('puzzle.credit')}</p>
      </aside>
    </main>
  );
}
