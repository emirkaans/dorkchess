import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { createGame, legalMoves, makeMove, parseSquare } from '../engine/index.ts';
import type { GameState, Move, VariantDefinition } from '../engine/index.ts';
import type { RuleExample } from '../rules/cards.ts';
import { Board } from './Board.tsx';
import { useI18n } from './i18n.tsx';

/** The example's arrows that are legal moves in its position (what the player is asked to play). */
export function tasksOf(variant: VariantDefinition, state: GameState, example: RuleExample): Move[] {
  const legal = legalMoves(variant, state.position);
  return example.arrows.flatMap(([from, to]) => {
    const f = parseSquare(from);
    const t = parseSquare(to);
    const m = legal.find((x) => x.from === f && x.to === t);
    return m ? [m] : [];
  });
}

type Outcome = 'idle' | 'right' | 'other';

/**
 * A rule card example to play on: the arrows are the task. A legal arrow move
 * is praised; another legal move is played and shown as "not this one"; an
 * arrow that is not a legal move (the example shows what the rule forbids)
 * simply cannot be played, which is the lesson.
 */
export function TryDiagram({
  variant,
  example,
  size,
}: {
  variant: VariantDefinition;
  example: RuleExample;
  size: number;
}) {
  const { t } = useI18n();
  const start = useMemo(() => createGame(variant, example.fen), [variant, example.fen]);
  const [state, setState] = useState(start);
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const tasks = useMemo(() => tasksOf(variant, start, example), [variant, start, example]);
  const arrows = useMemo(
    () =>
      outcome === 'idle' ? example.arrows.map(([a, b]) => [parseSquare(a), parseSquare(b)] as [number, number]) : [],
    [example.arrows, outcome],
  );
  const reset = () => {
    setState(start);
    setOutcome('idle');
  };

  return (
    <div className="try-diagram">
      <div className="diagram" style={{ '--board': `${size}px` } as CSSProperties}>
        <Board
          variant={variant}
          position={state.position}
          lastMove={state.moves.at(-1)?.move ?? null}
          flipped={false}
          highlight={example.highlights.map(parseSquare)}
          bandRanks={variant.highlight?.ranks ?? []}
          arrows={arrows}
          disabled={outcome !== 'idle'}
          onMove={(candidates) => {
            const move = candidates[0];
            setState(makeMove(variant, state, move));
            setOutcome(tasks.some((m) => m.from === move.from && m.to === move.to) ? 'right' : 'other');
          }}
        />
      </div>
      <p className={`try-status ${outcome}`} role="status">
        {outcome === 'right'
          ? t('rules.tryRight')
          : outcome === 'other'
            ? t('rules.tryOther')
            : tasks.length
              ? t('rules.tryTask')
              : t('rules.tryForbidden')}
      </p>
      {outcome !== 'idle' && (
        <button type="button" onClick={reset}>
          {t('rules.tryAgain')}
        </button>
      )}
    </div>
  );
}
