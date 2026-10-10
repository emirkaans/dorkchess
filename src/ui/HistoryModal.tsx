import { useMemo, useState } from 'react';
import { Modal } from './Modal.tsx';
import { getVariant } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { importPgn, loadGames, replay, storeGame } from '../storage/games.ts';
import type { SavedGame } from '../storage/games.ts';
import { errorText } from '../i18n/index.ts';
import { recordTexts } from '../i18n/records.ts';
import { GameViewer } from './GameViewer.tsx';
import { useI18n } from './i18n.tsx';
import type { I18n } from './i18n.tsx';

interface Props {
  onClose: () => void;
  onOpenAnalysis: (variantId: string, states: readonly GameState[], cursor: number) => void;
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

/** History: stored games, replay with a slider, PGN-like export/import. */
export function HistoryModal({ onClose, onOpenAnalysis }: Props) {
  const { t, vt, locale } = useI18n();
  const [games, setGames] = useState<SavedGame[]>(() => loadGames());
  const [open, setOpen] = useState<SavedGame | null>(null);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doImport = () => {
    try {
      const { game } = importPgn(importText);
      setGames((list) => storeGame(game, list));
      setImportText('');
      setError(null);
      setOpen(game);
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  return (
    <Modal label={t('history.label')} className={open ? 'viewer-modal' : 'history'} onClose={onClose}>
      <div>
        {open ? (
          <Replay game={open} onBack={() => setOpen(null)} onOpenAnalysis={onOpenAnalysis} />
        ) : (
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
                          <button onClick={() => setOpen(g)}>{t('history.view')}</button>
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
        )}
      </div>
    </Modal>
  );
}

function Replay({
  game,
  onBack,
  onOpenAnalysis,
}: {
  game: SavedGame;
  onBack: () => void;
  onOpenAnalysis: Props['onOpenAnalysis'];
}) {
  const { t, vt } = useI18n();
  const variant = getVariant(game.variantId);
  const states = useMemo<GameState[]>(() => replay(game), [game]);
  const texts = recordTexts(game, t);

  return (
    <div className="replay">
      <GameViewer
        variant={variant}
        states={states}
        title={
          <h2>
            {variantName(game.variantId, vt)} · {texts.white} – {texts.black} · {game.result}
          </h2>
        }
        meta={{ white: texts.white, black: texts.black, result: game.result, termination: texts.termination }}
        onOpenAnalysis={(all, cursor) => onOpenAnalysis(game.variantId, all, cursor)}
      >
        <button onClick={onBack}>{t('history.back')}</button>
      </GameViewer>
    </div>
  );
}
