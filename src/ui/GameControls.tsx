import type { ReactNode } from 'react';
import type { Run } from './game/session.ts';
import { useI18n } from './i18n.tsx';

interface Props {
  /** Against the bot (undo pair, hint, draw offer) instead of browsing back / forward. */
  vsBot: boolean;
  watching: boolean;
  over: boolean;
  setupPending: boolean;
  canUndo: boolean;
  hintEnabled: boolean;
  hintBusy: boolean;
  run: Run;
  atEnd: boolean;
  highlightLabel: string | null;
  showHighlight: boolean;
  onUndo: () => void;
  onHint: () => void;
  onDraw: () => void;
  onResign: () => void;
  onRun: (run: Run) => void;
  onToggleHighlight: () => void;
}

/** Stroke icon from one or more path strings. */
function Icon({ d, className = '' }: { d: string | string[]; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {(Array.isArray(d) ? d : [d]).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

const ICONS = {
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  hint: ['M9 18h6M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z'],
  draw: 'M5 10h14M5 15h14',
  resign: ['M5 21V4', 'M5 4h12l-3 4 3 4H5'],
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l12 8-12 8z',
  step: ['M6 4l10 8-10 8z', 'M19 4v16'],
  highlight: ['M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  flip: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  copy: [
    'M10 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    'M15 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4',
  ],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'M12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  check: 'M5 12l5 5 9-10',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
};

function ControlButton(props: {
  icon: string | string[];
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`control ${props.className ?? ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-pressed={props.pressed}
    >
      <Icon d={props.icon} />
      {props.children}
    </button>
  );
}

/** Main game actions in the side panel; which ones appear depends on the game mode. */
export function GameControls(p: Props) {
  const { t } = useI18n();
  return (
    <div className="controls">
      {p.vsBot && (
        <ControlButton icon={ICONS.undo} onClick={p.onUndo} disabled={!p.canUndo} title={t('controls.undoTitle')}>
          {t('controls.undo')}
        </ControlButton>
      )}
      {p.vsBot && (
        <ControlButton icon={ICONS.hint} className="lime" onClick={p.onHint} disabled={!p.hintEnabled || p.hintBusy}>
          {p.hintBusy ? t('controls.hintBusy') : t('controls.hint')}
        </ControlButton>
      )}
      {p.vsBot && (
        <ControlButton icon={ICONS.draw} onClick={p.onDraw} disabled={p.over || p.setupPending}>
          {t('controls.draw')}
        </ControlButton>
      )}
      {p.watching && (
        <>
          <ControlButton
            icon={p.run === 'play' ? ICONS.pause : ICONS.play}
            onClick={() => p.onRun(p.run === 'play' ? 'pause' : 'play')}
            disabled={p.over}
          >
            {p.run === 'play' ? t('controls.pause') : t('controls.resume')}
          </ControlButton>
          <ControlButton
            icon={ICONS.step}
            onClick={() => p.onRun('step')}
            disabled={p.run !== 'pause' || p.over || !p.atEnd}
          >
            {t('controls.step')}
          </ControlButton>
        </>
      )}
      {p.highlightLabel && (
        <ControlButton icon={ICONS.highlight} onClick={p.onToggleHighlight} pressed={p.showHighlight}>
          {p.highlightLabel}: {p.showHighlight ? t('controls.on') : t('controls.off')}
        </ControlButton>
      )}
      {!p.watching && (
        <ControlButton icon={ICONS.resign} className="danger" onClick={p.onResign} disabled={p.over || p.setupPending}>
          {t('controls.resign')}
        </ControlButton>
      )}
    </div>
  );
}

interface ToolProps {
  /** Browsing back / forward is offered when not playing the bot. */
  canBrowse: boolean;
  canBack: boolean;
  canForward: boolean;
  copied: 'fen' | 'game' | 'position' | null;
  hasMoves: boolean;
  onBack: () => void;
  onForward: () => void;
  onFlip: () => void;
  onCopy: () => void;
  /** Copies a link to the whole game (when it has moves) or to the shown position. */
  onCopyLink: (kind: 'game' | 'position') => void;
}

/** Icon bar under the move list: flip, copy, share links and move browsing. */
export function GameTools(p: ToolProps) {
  const { t } = useI18n();
  const tool = (key: string, label: string, icon: string | string[], onClick: () => void, disabled = false) => (
    <button key={key} className="tool" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <Icon d={icon} />
    </button>
  );
  return (
    <div className="tools">
      {tool('flip', t('controls.flip'), ICONS.flip, p.onFlip)}
      {tool(
        'fen',
        p.copied === 'fen' ? t('controls.copied') : t('controls.copyFen'),
        p.copied === 'fen' ? ICONS.check : ICONS.copy,
        p.onCopy,
      )}
      {p.hasMoves &&
        tool(
          'game',
          p.copied === 'game' ? t('controls.linkCopied') : t('controls.gameLink'),
          p.copied === 'game' ? ICONS.check : ICONS.link,
          () => p.onCopyLink('game'),
        )}
      {tool(
        'position',
        p.copied === 'position' ? t('controls.linkCopied') : t('controls.positionLink'),
        p.copied === 'position' ? ICONS.check : ICONS.pin,
        () => p.onCopyLink('position'),
      )}
      {p.canBrowse && tool('back', t('nav.back'), ICONS.back, p.onBack, !p.canBack)}
      {p.canBrowse && tool('forward', t('nav.forward'), ICONS.forward, p.onForward, !p.canForward)}
    </div>
  );
}
