// Playing through a puzzle: the opponent's opening move, the player's moves
// checked against the solution, the opponent's answers, a hint, the solution
// shown. Used by the puzzle page and the daily puzzle.

import { useEffect, useRef, useState } from 'react';
import { createGame, findMove, getVariant, listVariants, makeMove, parseSquare, squareName } from '../engine/index.ts';
import type { Color, GameState, Move, PieceType, VariantDefinition } from '../engine/index.ts';
import { isSolutionMove } from '../online/puzzle.ts';
import type { PuzzleData } from '../online/puzzle.ts';
import { moveSound, playSound } from './sound.ts';

export type PuzzleStatus = 'loading' | 'empty' | 'opponent' | 'play' | 'wrong' | 'solved' | 'shown';

export const toUci = (m: Move) => `${squareName(m.from)}${squareName(m.to)}${m.promotion ?? ''}`;

/** Plays a UCI move on a state (null when it is not legal there). */
export function playUci(state: GameState, uci: string): GameState | null {
  const v = getVariant(state.variantId);
  const promotion = uci.length > 4 ? (uci[4] as PieceType) : undefined;
  const move = findMove(v, state, parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)), promotion);
  return move ? makeMove(v, state, move) : null;
}

/** What happens along the way (each at most once per move). */
export interface PuzzleEvents {
  /** A right move by the player. */
  onCorrect?: () => void;
  /** A wrong move (the player may try again). */
  onWrong?: () => void;
  /** The last move found. */
  onSolved?: () => void;
  /** The solution shown; `left` is how many of the player's moves were still to find. */
  onShown?: (left: number) => void;
}

export interface PuzzleRunner {
  readonly puzzle: PuzzleData | null;
  readonly state: GameState | null;
  readonly status: PuzzleStatus;
  readonly setStatus: (s: PuzzleStatus) => void;
  readonly variant: VariantDefinition;
  /** The colour the player plays. */
  readonly you: Color;
  readonly hint: boolean;
  readonly showHint: () => void;
  /** Squares to light up for the hint. */
  readonly hintSquares: readonly number[];
  readonly over: boolean;
  /**
   * Shows a puzzle; `finished` shows its end at once (a daily puzzle already done).
   * The opponent's first move comes after `delay` ms.
   */
  readonly start: (p: PuzzleData, finished?: 'solved' | 'shown', delay?: number) => void;
  readonly onMove: (candidates: Move[]) => void;
  readonly showSolution: () => void;
}

export function usePuzzleRunner(sound: boolean, events: PuzzleEvents): PuzzleRunner {
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [ply, setPly] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>('loading');
  const [hint, setHint] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const on = useRef(events);
  useEffect(() => {
    on.current = events;
  });
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, f: () => void) => timers.current.push(setTimeout(f, ms));
  const click = (s: GameState) => {
    if (sound) playSound(moveSound(s.moves.at(-1)?.move.captured !== undefined, !!s.result));
  };

  const start = (p: PuzzleData, finished?: 'solved' | 'shown', delay = 700) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPuzzle(p);
    setHint(false);
    let game = createGame(getVariant(p.variantId), p.fen);
    if (finished) {
      for (const uci of p.moves) game = playUci(game, uci) ?? game;
      setState(game);
      setPly(p.moves.length);
      setStatus(finished);
      return;
    }
    setState(game);
    setPly(0);
    setStatus('opponent');
    later(delay, () => {
      const next = playUci(game, p.moves[0]);
      if (!next) return setStatus('empty');
      setState(next);
      setPly(1);
      setStatus('play');
      click(next);
    });
  };

  const onMove = (candidates: Move[]) => {
    if (status !== 'play' || !puzzle || !state) return;
    const move = candidates.find((m) => toUci(m) === puzzle.moves[ply]) ?? candidates[0];
    const next = makeMove(getVariant(state.variantId), state, move);
    if (!isSolutionMove(puzzle.moves, ply, toUci(move), next.result?.reason === 'checkmate')) {
      setStatus('wrong');
      setHint(false);
      on.current.onWrong?.();
      later(900, () => setStatus('play'));
      return;
    }
    setState(next);
    click(next);
    setHint(false);
    on.current.onCorrect?.();
    if (ply + 1 >= puzzle.moves.length) {
      setPly(ply + 1);
      setStatus('solved');
      on.current.onSolved?.();
      return;
    }
    // The opponent answers.
    setPly(ply + 1);
    setStatus('opponent');
    later(500, () => {
      const answered = playUci(next, puzzle.moves[ply + 1]);
      if (!answered) {
        setStatus('solved');
        on.current.onSolved?.();
        return;
      }
      setState(answered);
      setPly(ply + 2);
      setStatus('play');
      click(answered);
    });
  };

  /** Plays the rest of the solution, a move every half second. */
  const showSolution = () => {
    if (!puzzle || !state || status === 'solved' || status === 'shown') return;
    // The player's moves still to find: every other move from here.
    on.current.onShown?.(Math.ceil((puzzle.moves.length - ply) / 2));
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

  const variant = puzzle ? getVariant(puzzle.variantId) : listVariants()[0];
  // The player is the side to move after the opponent's first move.
  const you: Color = puzzle ? (createGame(variant, puzzle.fen).position.turn === 'w' ? 'b' : 'w') : 'w';
  const expected = puzzle && status === 'play' ? puzzle.moves[ply] : null;
  return {
    puzzle,
    state,
    status,
    setStatus,
    variant,
    you,
    hint,
    showHint: () => setHint(true),
    hintSquares: hint && expected ? [parseSquare(expected.slice(0, 2))] : [],
    over: status === 'solved' || status === 'shown',
    start,
    onMove,
    showSolution,
  };
}
