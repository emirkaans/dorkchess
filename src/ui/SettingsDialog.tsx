import { listVariants } from '../engine/index.ts';
import type { PieceType } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';
import { PieceView } from './PieceView.tsx';
import { BOARD_THEMES, PIECE_THEMES } from './prefs.ts';
import type { Prefs } from './prefs.ts';

interface Props {
  prefs: Prefs;
  onPrefs: (update: (p: Prefs) => Prefs) => void;
  onClose: () => void;
}

const PREVIEW: { type: PieceType; color: 'w' | 'b' }[] = [
  { type: 'k', color: 'w' },
  { type: 'n', color: 'b' },
  { type: 'q', color: 'b' },
  { type: 'n', color: 'w' },
];

/** Board and piece themes, sound. The preview row uses the live theme. */
export function SettingsDialog({ prefs, onPrefs, onClose }: Props) {
  const { t } = useI18n();
  // Any variant shows the standard pieces; the first one is the plainest.
  const standard = listVariants()[0];
  return (
    <Modal label={t('settings.title')} className="settings" onClose={onClose}>
      <h2>{t('settings.title')}</h2>
      <div className="theme-preview" aria-hidden="true">
        {PREVIEW.map((p, i) => (
          <span key={i} className={`square ${i % 2 ? 'dark' : 'light'}`}>
            <PieceView variant={standard} piece={p} />
          </span>
        ))}
      </div>
      <fieldset className="choice-row">
        <legend>{t('settings.board')}</legend>
        {BOARD_THEMES.map((theme) => (
          <label key={theme} className={prefs.boardTheme === theme ? 'chip on' : 'chip'}>
            <input
              type="radio"
              name="board-theme"
              checked={prefs.boardTheme === theme}
              onChange={() => onPrefs((p) => ({ ...p, boardTheme: theme }))}
            />
            {t(`theme.${theme}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <fieldset className="choice-row">
        <legend>{t('settings.pieces')}</legend>
        {PIECE_THEMES.map((theme) => (
          <label key={theme} className={prefs.pieceTheme === theme ? 'chip on' : 'chip'}>
            <input
              type="radio"
              name="piece-theme"
              checked={prefs.pieceTheme === theme}
              onChange={() => onPrefs((p) => ({ ...p, pieceTheme: theme }))}
            />
            {t(`pieces.${theme}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <label className="switch-row">
        <input type="checkbox" checked={prefs.sound} onChange={() => onPrefs((p) => ({ ...p, sound: !p.sound }))} />
        <span className="switch" aria-hidden="true" />
        {t('toolbar.sound')}
      </label>
      <div className="modal-actions">
        <button className="primary" onClick={onClose} data-autofocus>
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}
