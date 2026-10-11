import { useState } from 'react';
import { Modal } from './Modal.tsx';
import { getVariant } from '../engine/index.ts';
import { importPgn, loadGames, storeGame } from '../storage/games.ts';
import type { SavedGame } from '../storage/games.ts';
import { errorText } from '../i18n/index.ts';
import { recordTexts } from '../i18n/records.ts';
import { useI18n } from './i18n.tsx';
import type { I18n } from './i18n.tsx';

interface Props {
  onClose: () => void;
  /** Opens a stored game on the review page. */
  onOpenGame: (game: SavedGame) => void;
}

const formatDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

const variantName = (id: string, vt: I18n['vt']) => {
  try {
    return vt(getVariant(id)).name;
  } catch {
    return id;
  }
};

/** History: stored games (each opens on the review page) and PGN-like import. */
export function HistoryModal({ onClose, onOpenGame }: Props) {
  const { t, vt, locale } = useI18n();
  const [games, setGames] = useState<SavedGame[]>(() => loadGames());
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doImport = () => {
    try {
      const { game } = importPgn(importText);
      setGames((list) => storeGame(game, list));
      setImportText('');
      setError(null);
      onOpenGame(game);
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  return (
    <Modal label={t('history.label')} className="history" onClose={onClose}>
      <div>
        {
          <>
            <h2>{t('history.title')}</h2>
            {games.length === 0 ? (
              <p className="muted">{t('history.empty')}</p>
            ) : (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>{t('history.date')}</th>
                    <th>{t('history.variant')}</th>
                    <th>{t('history.mode')}</th>
                    <th>{t('history.players')}</th>
                    <th>{t('history.result')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => {
                    const r = recordTexts(g, t);
                    return (
                      <tr key={g.id}>
                        <td>{formatDate(g.date, locale)}</td>
                        <td>{variantName(g.variantId, vt)}</td>
                        <td>{r.mode}</td>
                        <td>
                          {r.white} – {r.black}
                        </td>
                        <td>
                          {g.result}
                          {r.termination && <span className="muted"> {r.termination}</span>}
                        </td>
                        <td>
                          <button onClick={() => onOpenGame(g)}>{t('history.view')}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <details className="import">
              <summary>{t('history.import')}</summary>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={'[Variant "jester"]\n\n1. e4 e5 2. Nc3 Nc6 *'}
              />
              {error && <p className="error">{error}</p>}
              <button onClick={doImport} disabled={!importText.trim()}>
                {t('history.importButton')}
              </button>
            </details>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                {t('close')}
              </button>
            </div>
          </>
        }
      </div>
    </Modal>
  );
}
