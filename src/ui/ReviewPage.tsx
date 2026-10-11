import type { ReactNode } from 'react';
import { getVariant } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { GameViewer } from './GameViewer.tsx';
import type { PgnMeta } from './ShareTools.tsx';
import { useI18n } from './i18n.tsx';

/** A finished game opened for analysis on its own page. */
export interface Review {
  /** Changes with every opened game (the viewer starts afresh). */
  readonly key: number;
  readonly variantId: string;
  readonly states: readonly GameState[];
  /** Line under the heading (players, time control, …). */
  readonly subtitle: string;
  readonly meta?: PgnMeta;
  /** The game's id: the page's address is /<id>/analysis (or /<id> when just watching). */
  readonly gameId?: string;
  /** Opened from a game link (/<id>): shown without starting the analysis. */
  readonly watch?: boolean;
}

interface Props {
  review: Review;
  /** Back to where it came from. */
  onBack: () => void;
  backLabel: string;
  onOpenAnalysis: (variantId: string, states: readonly GameState[], cursor: number) => void;
}

/** Post-game analysis page: the game viewer, analysing the game right away. */
export function ReviewPage({ review, onBack, backLabel, onOpenAnalysis }: Props): ReactNode {
  const { t } = useI18n();
  const variant = getVariant(review.variantId);
  return (
    <main className="review-page">
      <GameViewer
        key={review.key}
        variant={variant}
        states={review.states}
        autoAnalyse={!review.watch}
        gameId={review.gameId}
        title={
          <>
            <h2>{review.watch ? t('review.game') : t('analysis.title')}</h2>
            <p className="muted">{review.subtitle}</p>
          </>
        }
        meta={review.meta}
        onOpenAnalysis={(states, cursor) => onOpenAnalysis(review.variantId, states, cursor)}
      >
        <button onClick={onBack}>{backLabel}</button>
      </GameViewer>
    </main>
  );
}
