import { useI18n } from './i18n.tsx';

/**
 * Laid over the board when the game is over: the board darkens and the result
 * is written on it (a big "MATE!" for checkmate). Clicks pass through, so the
 * board can still be looked at, and moves browsed from the move list.
 */
export function GameOverOverlay({ mate, text }: { mate: boolean; text: string }) {
  const { t } = useI18n();
  return (
    <div className={`game-over${mate ? ' mate' : ''}`} aria-hidden="true">
      <div className="game-over-card">
        <span className="game-over-title">{mate ? t('over.mate') : t('over.title')}</span>
        <span className="game-over-text">{text}</span>
      </div>
    </div>
  );
}
