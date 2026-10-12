import { useCallback, useEffect, useRef, useState } from 'react';
import { createGame, findMove, getVariant, listVariants, makeMove, parseSquare, squareName } from '../engine/index.ts';
import type { Color, GameState, Move, PieceType } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { PUZZLE_THEMES, isSolutionMove } from '../online/puzzle.ts';
import type { PuzzleData, PuzzleNext, PuzzleResult, PuzzleTheme } from '../online/puzzle.ts';
import { DEFAULT_GLICKO, PROVISIONAL_RD, update } from '../rating/glicko2.ts';
import type { Glicko } from '../rating/glicko2.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';
import { useAccount } from './account.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';
import { playSound, moveSound } from './sound.ts';
import type { Prefs } from './prefs.ts';

type Status = 'loading' | 'empty' | 'opponent' | 'play' | 'wrong' | 'solved' | 'shown';

const GUEST_KEY = 'puzzle:rating';
const toUci = (m: Move) => `${squareName(m.from)}${squareName(m.to)}${m.promotion ?? ''}`;

/** Plays a UCI move on a state (null when it is not legal there). */
function playUci(state: GameState, uci: string): GameState | null {
  const v = getVariant(state.variantId);
  const promotion = uci.length > 4 ? (uci[4] as PieceType) : undefined;
  const move = findMove(v, state, parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), promotion);
  return move ? makeMove(v, state, move) : null;
}

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
  const { t } = useI18n();
  const account = useAccount();
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [ply, setPly] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [theme, setTheme] = useState<PuzzleTheme | null>(null);
  const [hint, setHint] = useState(false);
  const [rating, setRating] = useState<{ rating: number; provisional: boolean } | null>(null);
  const [diff, setDiff] = useState<number | null>(null);
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, f: () => void) => timers.current.push(setTimeout(f, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const guest = !account.loading && !account.user;
  const guestRating = (): Glicko => loadJSON<Glicko>(GUEST_KEY, DEFAULT_GLICKO);
  const showRating = (g: Glicko) => ({ rating: Math.round(g.rating), provisional: g.rd > PROVISIONAL_RD });

  /** Shows a puzzle: its position, then the opponent's move that sets it up. */
  const start = useCallback(
    (p: PuzzleData) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      reported.current = false;
      setPuzzle(p);
      setHint(false);
      setDiff(null);
      const game = createGame(getVariant(p.variantId), p.fen);
      setState(game);
      setPly(0);
      setStatus('opponent');
      timers.current.push(
        setTimeout(() => {
          const next = playUci(game, p.moves[0]);
          if (!next) return setStatus('empty');
          setState(next);
          setPly(1);
          setStatus('play');
          if (prefs.sound) playSound(moveSound(next.moves.at(-1)?.move.captured !== undefined, false));
        }, 700),
      );
    },
    [prefs.sound],
  );

  const load = useCallback(
    async (id: string | null, th: PuzzleTheme | null) => {
      setStatus('loading');
      const params = new URLSearchParams();
      if (account.loading) return;
      if (!account.user) params.set('rating', String(Math.round(guestRating().rating)));
      if (th) params.set('theme', th);
      try {
        const res = await fetch(id ? `/api/puzzles/${id}` : `/api/puzzles/next?${params}`);
        const data = (await res.json()) as Partial<PuzzleNext> & { puzzle?: PuzzleData | null };
        if (data.rating) setRating(data.rating);
        else if (!account.user) setRating(showRating(guestRating()));
        if (!data.puzzle) return setStatus('empty');
        start(data.puzzle);
      } catch {
        setStatus('empty');
      }
    },
    [account.loading, account.user, start],
  );

  useEffect(() => {
    void load(puzzleId, theme);
    // Only when the address or the player changes; the theme reloads through its buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleId, account.loading, account.user]);

  /** The first result of a puzzle counts (a wrong move or the solution shown is a fail). */
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
      const r = (await res.json()) as PuzzleResult;
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

  const onMove = (candidates: Move[]) => {
    if (status !== 'play' || !puzzle || !state) return;
    const expected = puzzle.moves[ply];
    const move = candidates.find((m) => toUci(m) === expected) ?? candidates[0];
    const v = getVariant(state.variantId);
    const next = makeMove(v, state, move);
    const mate = next.result?.reason === 'checkmate';
    if (!isSolutionMove(puzzle.moves, ply, toUci(move), mate)) {
      setStatus('wrong');
      setHint(false);
      void report(false);
      later(900, () => setStatus('play'));
      return;
    }
    setState(next);
    if (prefs.sound) playSound(moveSound(move.captured !== undefined, !!next.result));
    const done = ply + 1 >= puzzle.moves.length;
    setPly(ply + 1);
    setHint(false);
    if (done) {
      setStatus('solved');
      void report(true);
      return;
    }
    // The opponent answers.
    setStatus('opponent');
    later(500, () => {
      const answered = playUci(next, puzzle.moves[ply + 1]);
      if (!answered) return setStatus('solved');
      setState(answered);
      setPly(ply + 2);
      setStatus('play');
      if (prefs.sound) playSound(moveSound(answered.moves.at(-1)?.move.captured !== undefined, false));
    });
  };

  /** Plays the rest of the solution, a move every half second (counts as a fail). */
  const showSolution = () => {
    if (!puzzle || !state) return;
    void report(false);
    setStatus('shown');
    let s = state;
    puzzle.moves.slice(ply).forEach((uci, i) => {
      later(500 * (i + 1), () => {
        const n = playUci(s, uci);
        if (!n) return;
        s = n;
        setState(n);
      });
    });
    setPly(puzzle.moves.length);
  };

  const next = () => {
    if (puzzleId) onOpen('/puzzles');
    else void load(null, theme);
  };
  const pickTheme = (th: PuzzleTheme | null) => {
    setTheme(th);
    if (puzzleId) onOpen('/puzzles');
    void load(null, th);
  };

  const variant = puzzle ? getVariant(puzzle.variantId) : listVariants()[0];
  // The player is the side to move after the opponent's first move.
  const you: Color = puzzle ? (createGame(variant, puzzle.fen).position.turn === 'w' ? 'b' : 'w') : 'w';
  const expected = puzzle && status === 'play' ? puzzle.moves[ply] : null;
  const over = status === 'solved' || status === 'shown';

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
              highlight={hint && expected ? [parseSquare(expected.slice(0, 2))] : []}
              bandRanks={[]}
              disabled={status !== 'play'}
              onMove={onMove}
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

        <div className="puzzle-actions">
          {!over && (
            <>
              <button disabled={status !== 'play'} onClick={() => setHint(true)}>
                {t('puzzle.hint')}
              </button>
              <button disabled={!puzzle || status === 'loading' || status === 'opponent'} onClick={showSolution}>
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

        {guest && <p className="muted puzzle-note">{t('puzzle.guestNote')}</p>}
        <p className="muted puzzle-credit">{t('puzzle.credit')}</p>
      </aside>
    </main>
  );
}
