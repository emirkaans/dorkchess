import { useEffect, useState } from 'react';
import { useI18n } from './i18n.tsx';

/** How long the result stays on the board (the CSS fade ends at the same time). */
export const GAME_OVER_MS = 1800;

/**
 * Laid over the board when the game is over: for a few seconds the board darkens
 * and the result is written on it (a big "MATE!" for checkmate), then it fades
 * away (CSS). Clicks pass through, so the board stays usable throughout.
 */
export function GameOverOverlay({ mate, text }: { mate: boolean; text: string }) {
  const { t } = useI18n();
  // Removed when its time is up (also when reduced motion turns the fade off).
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), GAME_OVER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div className={`game-over${mate ? ' mate' : ''}`} aria-hidden="true">
      <div className="game-over-card">
        <span className="game-over-title">{mate ? t('over.mate') : t('over.title')}</span>
        <span className="game-over-text">{text}</span>
      </div>
    </div>
  );
}
