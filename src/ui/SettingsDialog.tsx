import { useState } from 'react';
import type { ReactNode } from 'react';
import { listVariants } from '../engine/index.ts';
import type { PieceType } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { Modal } from './Modal.tsx';
import { PieceView, SetPiece } from './PieceView.tsx';
import { PIECE_SETS } from './pieceSets.ts';
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

type View = 'main' | 'board' | 'pieces' | 'set';

/**
 * Settings: a short menu (board, piece colours, piece set, sound); each look
 * opens its own page of small previews to pick from.
 */
export function SettingsDialog({ prefs, onPrefs, onClose }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('main');
  // Any variant shows the standard pieces; the first one is the plainest.
  const standard = listVariants()[0];
  const knights = (
    <>
      <span className="square light">
        <PieceView variant={standard} piece={{ type: 'n', color: 'w' }} />
      </span>
      <span className="square dark">
        <PieceView variant={standard} piece={{ type: 'n', color: 'b' }} />
      </span>
    </>
  );

  if (view !== 'main') {
    const title = t(view === 'board' ? 'settings.board' : view === 'pieces' ? 'settings.pieces' : 'settings.pieceSet');
    const tiles =
      view === 'board'
        ? BOARD_THEMES.map((theme) => ({
            id: theme,
            name: t(`theme.${theme}` as MessageKey),
            on: prefs.boardTheme === theme,
            pick: () => onPrefs((p) => ({ ...p, boardTheme: theme })),
            preview: (
              <span className="tile-squares" data-board={theme}>
                <span className="square light" />
                <span className="square dark" />
              </span>
            ),
          }))
        : view === 'pieces'
          ? PIECE_THEMES.map((theme) => ({
              id: theme,
              name: t(`pieces.${theme}` as MessageKey),
              on: prefs.pieceTheme === theme,
              pick: () => onPrefs((p) => ({ ...p, pieceTheme: theme })),
              preview: (
                <span className="tile-squares" data-pieces={theme}>
                  {knights}
                </span>
              ),
            }))
          : PIECE_SETS.map((set) => ({
              id: set,
              name: t(`pieceSet.${set}` as MessageKey),
              on: prefs.pieceSet === set,
              pick: () => onPrefs((p) => ({ ...p, pieceSet: set })),
              preview: (
                <span className="tile-squares">
                  <span className="square light">
                    <SetPiece set={set} color="w" />
                  </span>
                  <span className="square dark">
                    <SetPiece set={set} color="b" />
                  </span>
                </span>
              ),
            }));
    return (
      <Modal label={title} className="settings" onClose={onClose}>
        <h2 className="settings-sub">
          <button className="settings-back" onClick={() => setView('main')} aria-label={t('settings.back')}>
            <Chevron back />
          </button>
          {title}
        </h2>
        <div className="tile-grid" role="radiogroup" aria-label={title}>
          {tiles.map((tile) => (
            <label key={tile.id} className={tile.on ? 'tile on' : 'tile'} title={tile.name}>
              <input type="radio" name={`settings-${view}`} checked={tile.on} onChange={tile.pick} />
              {tile.preview}
              <span className="tile-name">{tile.name}</span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={() => setView('main')}>{t('settings.back')}</button>
          <button className="primary" onClick={onClose} data-autofocus>
            {t('close')}
          </button>
        </div>
      </Modal>
    );
  }

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
      <nav className="settings-menu">
        <MenuLink
          label={t('settings.board')}
          value={t(`theme.${prefs.boardTheme}` as MessageKey)}
          onClick={() => setView('board')}
        >
          <span className="tile-squares small">
            <span className="square light" />
            <span className="square dark" />
          </span>
        </MenuLink>
        <MenuLink
          label={t('settings.pieces')}
          value={t(`pieces.${prefs.pieceTheme}` as MessageKey)}
          onClick={() => setView('pieces')}
        >
          <span className="tile-squares small">{knights}</span>
        </MenuLink>
        <MenuLink
          label={t('settings.pieceSet')}
          value={t(`pieceSet.${prefs.pieceSet}` as MessageKey)}
          onClick={() => setView('set')}
        >
          <span className="tile-squares small">
            <span className="square light">
              <SetPiece set={prefs.pieceSet} color="w" />
            </span>
          </span>
        </MenuLink>
      </nav>
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

function MenuLink({
  label,
  value,
  onClick,
  children,
}: {
  label: string;
  value: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="settings-link" onClick={onClick}>
      <span aria-hidden="true">{children}</span>
      <span className="settings-link-text">
        <span className="settings-link-label">{label}</span>
        <span className="settings-link-value">{value}</span>
      </span>
      <Chevron />
    </button>
  );
}

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}
