import type { Run } from './game/session.ts';
import { useI18n } from './i18n.tsx';

interface Props {
  /** Against the bot (undo pair, hint, draw offer) instead of browsing back / forward. */
  vsBot: boolean;
  watching: boolean;
  over: boolean;
  setupPending: boolean;
  canUndo: boolean;
  canBack: boolean;
  canForward: boolean;
  hintEnabled: boolean;
  hintBusy: boolean;
  run: Run;
  atEnd: boolean;
  highlightLabel: string | null;
  showHighlight: boolean;
  copied: 'fen' | 'game' | 'position' | null;
  onUndo: () => void;
  onBack: () => void;
  onForward: () => void;
  onHint: () => void;
  onDraw: () => void;
  onResign: () => void;
  onRun: (run: Run) => void;
  onFlip: () => void;
  onToggleHighlight: () => void;
  onCopy: () => void;
  /** Copies a link to the whole game (when it has moves) or to the shown position. */
  onCopyLink: (kind: 'game' | 'position') => void;
  hasMoves: boolean;
}

/** Buttons under the board; which ones appear depends on the game mode. */
export function GameControls(p: Props) {
  const { t } = useI18n();
  return (
    <div className="controls">
      {p.vsBot ? (
        <button onClick={p.onUndo} disabled={!p.canUndo} title={t('controls.undoTitle')}>
          {t('controls.undo')}
        </button>
      ) : (
        <>
          <button onClick={p.onBack} disabled={!p.canBack} title={t('nav.back')}>
            {t('controls.back')}
          </button>
          <button onClick={p.onForward} disabled={!p.canForward} title={t('nav.forward')}>
            {t('controls.forward')}
          </button>
        </>
      )}
      {p.vsBot && (
        <button onClick={p.onHint} disabled={!p.hintEnabled || p.hintBusy}>
          {p.hintBusy ? t('controls.hintBusy') : t('controls.hint')}
        </button>
      )}
      {p.vsBot && (
        <button onClick={p.onDraw} disabled={p.over || p.setupPending}>
          {t('controls.draw')}
        </button>
      )}
      {!p.watching && (
        <button onClick={p.onResign} disabled={p.over || p.setupPending}>
          {t('controls.resign')}
        </button>
      )}
      {p.watching && (
        <>
          <button onClick={() => p.onRun(p.run === 'play' ? 'pause' : 'play')} disabled={p.over}>
            {p.run === 'play' ? t('controls.pause') : t('controls.resume')}
          </button>
          <button onClick={() => p.onRun('step')} disabled={p.run !== 'pause' || p.over || !p.atEnd}>
            {t('controls.step')}
          </button>
        </>
      )}
      <button onClick={p.onFlip}>{t('controls.flip')}</button>
      {p.highlightLabel && (
        <button onClick={p.onToggleHighlight} aria-pressed={p.showHighlight}>
          {p.highlightLabel}: {p.showHighlight ? t('controls.on') : t('controls.off')}
        </button>
      )}
      <button onClick={p.onCopy}>{p.copied === 'fen' ? t('controls.copied') : t('controls.copyFen')}</button>
      {p.hasMoves && (
        <button onClick={() => p.onCopyLink('game')}>
          {p.copied === 'game' ? t('controls.linkCopied') : t('controls.gameLink')}
        </button>
      )}
      <button onClick={() => p.onCopyLink('position')}>
        {p.copied === 'position' ? t('controls.linkCopied') : t('controls.positionLink')}
      </button>
    </div>
  );
}
