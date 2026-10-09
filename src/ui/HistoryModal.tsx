import { useMemo, useState } from 'react';
import { Modal } from './Modal.tsx';
import { getVariant } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { exportPgn, importPgn, loadGames, replay, storeGame } from '../storage/games.ts';
import { encodeGame } from '../storage/share.ts';
import type { SavedGame } from '../storage/games.ts';
import { errorText } from '../i18n/index.ts';
import { recordTexts } from '../i18n/records.ts';
import { GameViewer } from './GameViewer.tsx';
import { useI18n } from './i18n.tsx';
import type { I18n } from './i18n.tsx';

interface Props {
  onClose: () => void;
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
export function HistoryModal({ onClose }: Props) {
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
    <Modal label={t('history.label')} className="history" onClose={onClose}>
      <div>
        {open ? (
          <Replay game={open} onBack={() => setOpen(null)} />
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

function Replay({ game, onBack }: { game: SavedGame; onBack: () => void }) {
  const { t, vt } = useI18n();
  const variant = getVariant(game.variantId);
  const states = useMemo<GameState[]>(() => replay(game), [game]);
  const [copied, setCopied] = useState<'pgn' | 'link' | null>(null);
  const texts = recordTexts(game, t);
  // The exported text carries the record's texts in the current language.
  const pgn = exportPgn({ ...game, ...texts });

  const copyText = async (text: string, what: 'pgn' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt(t('copyPrompt'), text);
    }
  };
  const link = () => location.origin + location.pathname + encodeGame(game);

  const download = () => {
    const url = URL.createObjectURL(new Blob([pgn], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dorkchess-${game.variantId}-${game.date.slice(0, 10)}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="replay">
      <h2>
        {variantName(game.variantId, vt)} · {texts.white} – {texts.black} · {game.result}
      </h2>
      <GameViewer variant={variant} states={states}>
        <button onClick={() => copyText(pgn, 'pgn')}>
          {copied === 'pgn' ? t('controls.copied') : t('history.copyText')}
        </button>
        <button onClick={() => copyText(link(), 'link')}>
          {copied === 'link' ? t('controls.linkCopied') : t('history.copyLink')}
        </button>
        <button onClick={download}>{t('history.download')}</button>
        <button onClick={onBack}>{t('history.back')}</button>
      </GameViewer>
    </div>
  );
}
