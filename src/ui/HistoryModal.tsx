import { useMemo, useState } from 'react';
import { getVariant } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { exportPgn, importPgn, loadGames, replay, storeGame } from '../storage/games.ts';
import { encodeGame } from '../storage/share.ts';
import type { SavedGame } from '../storage/games.ts';
import { GameViewer } from './GameViewer.tsx';

interface Props {
  onClose: () => void;
}

const formatDate = (iso: string) => new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

const variantName = (id: string) => {
  try {
    return getVariant(id).name;
  } catch {
    return id;
  }
};

/** "Geçmiş": stored games, replay with a slider, PGN-like export/import. */
export function HistoryModal({ onClose }: Props) {
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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop screen" onClick={onClose}>
      <div className="modal history" role="dialog" aria-label="Oyun geçmişi" onClick={(e) => e.stopPropagation()}>
        {open ? (
          <Replay game={open} onBack={() => setOpen(null)} />
        ) : (
          <>
            <h2>Geçmiş</h2>
            {games.length === 0 ? (
              <p className="muted">Henüz kayıtlı oyun yok. Biten oyunlar burada saklanır (en fazla 200).</p>
            ) : (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Varyant</th>
                    <th>Mod</th>
                    <th>Oyuncular</th>
                    <th>Sonuç</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id}>
                      <td>{formatDate(g.date)}</td>
                      <td>{variantName(g.variantId)}</td>
                      <td>{g.mode}</td>
                      <td>
                        {g.white} – {g.black}
                      </td>
                      <td>
                        {g.result}
                        {g.termination && <span className="muted"> {g.termination}</span>}
                      </td>
                      <td>
                        <button onClick={() => setOpen(g)}>İzle</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <details className="import">
              <summary>İçe aktar (PGN benzeri metin)</summary>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={'[Variant "jester"]\n\n1. e4 e5 2. Nc3 Nc6 *'}
              />
              {error && <p className="error">{error}</p>}
              <button onClick={doImport} disabled={!importText.trim()}>
                İçe aktar
              </button>
            </details>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                Kapat
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Replay({ game, onBack }: { game: SavedGame; onBack: () => void }) {
  const variant = getVariant(game.variantId);
  const states = useMemo<GameState[]>(() => replay(game), [game]);
  const [copied, setCopied] = useState<'pgn' | 'link' | null>(null);
  const pgn = useMemo(() => exportPgn(game), [game]);

  const copyText = async (text: string, what: 'pgn' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Kopyala:', text);
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
        {variantName(game.variantId)} · {game.white} – {game.black} · {game.result}
      </h2>
      <GameViewer variant={variant} states={states}>
        <button onClick={() => copyText(pgn, 'pgn')}>{copied === 'pgn' ? 'Kopyalandı ✓' : 'Metni kopyala'}</button>
        <button onClick={() => copyText(link(), 'link')}>
          {copied === 'link' ? 'Link kopyalandı ✓' : 'Linki kopyala'}
        </button>
        <button onClick={download}>İndir (.pgn)</button>
        <button onClick={onBack}>← Listeye dön</button>
      </GameViewer>
    </div>
  );
}
