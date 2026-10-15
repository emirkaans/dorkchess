import { useCallback, useEffect, useRef, useState } from 'react';
import { listVariants } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { PUZZLE_THEMES } from '../online/puzzle.ts';
import type { PatchNews, PuzzleData, PuzzleNext, PuzzleResult, PuzzleTheme } from '../online/puzzle.ts';
import { DEFAULT_GLICKO, PROVISIONAL_RD, update } from '../rating/glicko2.ts';
import type { Glicko } from '../rating/glicko2.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';
import { useAccount } from './account.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';
import { NewPatches } from './NewPatches.tsx';
import { usePuzzleRunner } from './puzzleRunner.ts';
import type { Prefs } from './prefs.ts';

const GUEST_KEY = 'puzzle:rating';

/**
 * /puzzles (and /puzzles/<id>): find the best move after the opponent's.
 * A signed-in player's puzzle rating lives on the server (first try only);
 * a guest's in the browser.
 */
export function PuzzlePage({
  puzzleId,
  prefs,
  onOpen,
}: {
  puzzleId: string | null;
  prefs: Prefs;
  onOpen: (path: string) => void;
}) {
  const { t, vt } = useI18n();
  const account = useAccount();
  const [theme, setTheme] = useState<PuzzleTheme | null>(null);
  // Standard chess, or one of the variants (their puzzles come from our engine).
  const [variantId, setVariantId] = useState(listVariants()[0].id);
  const standard = variantId === listVariants()[0].id;
  const [rating, setRating] = useState<{ rating: number; provisional: boolean } | null>(null);
  const [diff, setDiff] = useState<number | null>(null);
  const [patches, setPatches] = useState<readonly string[]>([]);
  const reported = useRef(false);
  // The first result of a puzzle counts (a wrong move or the solution shown is a fail).
  const run = usePuzzleRunner(prefs.sound, {
    onWrong: () => void report(false),
    onSolved: () => void report(true),
    onShown: () => void report(false),
  });
  const { puzzle, state, status, setStatus, variant, you, over } = run;

  const guest = !account.loading && !account.user;
  const guestRating = (): Glicko => loadJSON<Glicko>(GUEST_KEY, DEFAULT_GLICKO);
  const showRating = (g: Glicko) => ({ rating: Math.round(g.rating), provisional: g.rd > PROVISIONAL_RD });

  const load = useCallback(
    async (id: string | null, th: PuzzleTheme | null, vid: string = listVariants()[0].id) => {
      setStatus('loading');
      const params = new URLSearchParams();
      if (account.loading) return;
      if (!account.user) params.set('rating', String(Math.round(guestRating().rating)));
      if (th) params.set('theme', th);
      if (vid !== listVariants()[0].id) params.set('variant', vid);
      try {
        const res = await fetch(id ? `/api/puzzles/${id}` : `/api/puzzles/next?${params}`);
        const data = (await res.json()) as Partial<PuzzleNext> & { puzzle?: PuzzleData | null };
        if (data.rating) setRating(data.rating);
        else if (!account.user) setRating(showRating(guestRating()));
        if (!data.puzzle) return setStatus('empty');
        reported.current = false;
        setDiff(null);
        setPatches([]);
        run.start(data.puzzle);
      } catch {
        setStatus('empty');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account.loading, account.user],
  );

  useEffect(() => {
    void load(puzzleId, theme);
    // Only when the address or the player changes; the theme reloads through its buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleId, account.loading, account.user]);

  const report = async (solved: boolean) => {
    if (reported.current || !puzzle) return;
    reported.current = true;
    if (account.user) {
      const res = await fetch(`/api/puzzles/${puzzle.id}/result`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ solved }),
      }).catch(() => null);
      if (!res?.ok) return;
      const r = (await res.json()) as PuzzleResult & PatchNews;
      setPatches(r.newPatches ?? []);
      setRating({ rating: r.rating, provisional: r.provisional });
      setDiff(r.diff);
    } else {
      const before = guestRating();
      const after = update(before, [{ opponent: { rating: puzzle.rating, rd: 60, vol: 0.06 }, score: solved ? 1 : 0 }]);
      saveJSON(GUEST_KEY, after);
      setRating(showRating(after));
      setDiff(Math.round(after.rating) - Math.round(before.rating));
    }
  };

  const next = () => {
    if (puzzleId) onOpen('/puzzles');
    else void load(null, theme, variantId);
  };
  const pickTheme = (th: PuzzleTheme | null) => {
    setTheme(th);
    if (puzzleId) onOpen('/puzzles');
    void load(null, th, variantId);
  };
  const pickVariant = (vid: string) => {
    setVariantId(vid);
    setTheme(null);
    if (puzzleId) onOpen('/puzzles');
    void load(null, null, vid);
  };

  let line: string;
  if (status === 'loading' || status === 'opponent' || !puzzle) line = t('puzzle.loading');
  else if (status === 'empty') line = t('puzzle.empty');
  else if (status === 'wrong') line = t('puzzle.wrong');
  else if (status === 'solved') line = t('puzzle.solved');
  else if (status === 'shown') line = t('puzzle.shown');
  else line = t('puzzle.yourMove', { color: t(`color.${you}`) });

  return (
    <main className="analysis-page puzzle-page">
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
          <h1>{t('puzzle.title')}</h1>
        </div>

        <div className={`puzzle-status ${status}`} role="status">
          {line}
        </div>

        {rating && (
          <p className="puzzle-rating">
            {t(guest ? 'puzzle.ratingGuest' : 'puzzle.rating')}{' '}
            <strong>
              {rating.rating}
              {rating.provisional ? '?' : ''}
            </strong>
            {diff !== null && diff !== 0 && (
              <span className={diff > 0 ? 'up' : 'down'}>
                {' '}
                {diff > 0 ? '+' : ''}
                {diff}
              </span>
            )}
          </p>
        )}

        <NewPatches ids={patches} />

        <div className="puzzle-actions">
          {!over && (
            <>
              <button disabled={status !== 'play'} onClick={run.showHint}>
                {t('puzzle.hint')}
              </button>
              <button disabled={!puzzle || status === 'loading' || status === 'opponent'} onClick={run.showSolution}>
                {t('puzzle.solution')}
              </button>
            </>
          )}
          <button className={over ? 'primary analysis-go' : ''} onClick={next}>
            {t('puzzle.next')}
          </button>
        </div>

        {over && puzzle && (
          <p className="muted puzzle-info">
            {t('puzzle.difficulty', { n: String(puzzle.rating) })}
            {puzzle.themes.length > 0 &&
              ` · ${puzzle.themes
                .filter((th) => (PUZZLE_THEMES as readonly string[]).includes(th))
                .map((th) => t(`puzzle.theme.${th}` as MessageKey))
                .join(', ')}`}
          </p>
        )}

        <fieldset className="choice-row puzzle-themes">
          <legend>{t('newGame.variant')}</legend>
          {listVariants().map((v) => (
            <button key={v.id} className={`chip${variantId === v.id ? ' on' : ''}`} onClick={() => pickVariant(v.id)}>
              {vt(v).name}
            </button>
          ))}
        </fieldset>

        {standard && (
          <fieldset className="choice-row puzzle-themes">
            <legend>{t('puzzle.themes')}</legend>
            <button className={`chip${theme === null ? ' on' : ''}`} onClick={() => pickTheme(null)}>
              {t('puzzle.theme.all')}
            </button>
            {PUZZLE_THEMES.map((th) => (
              <button key={th} className={`chip${theme === th ? ' on' : ''}`} onClick={() => pickTheme(th)}>
                {t(`puzzle.theme.${th}`)}
              </button>
            ))}
          </fieldset>
        )}

        <div className="puzzle-modes">
          <button className="daily-link" onClick={() => onOpen('/daily')}>
            🔥 {t('puzzle.daily')} →
          </button>
          <button className="daily-link" onClick={() => onOpen('/rush')}>
            ⚡ {t('rush.title')} →
          </button>
        </div>

        {guest && <p className="muted puzzle-note">{t('puzzle.guestNote')}</p>}
        <p className="muted puzzle-credit">{t(standard ? 'puzzle.credit' : 'puzzle.creditVariant')}</p>
      </aside>
    </main>
  );
}
