import type { Run } from './game/session.ts';

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
  copied: boolean;
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
}

/** Buttons under the board; which ones appear depends on the game mode. */
export function GameControls(p: Props) {
  return (
    <div className="controls">
      {p.vsBot ? (
        <button onClick={p.onUndo} disabled={!p.canUndo} title="Son hamleni ve botun cevabını geri al">
          ↶ Geri al
        </button>
      ) : (
        <>
          <button onClick={p.onBack} disabled={!p.canBack} title="Geri">
            ◀ Geri
          </button>
          <button onClick={p.onForward} disabled={!p.canForward} title="İleri">
            İleri ▶
          </button>
        </>
      )}
      {p.vsBot && (
        <button onClick={p.onHint} disabled={!p.hintEnabled || p.hintBusy}>
          {p.hintBusy ? 'İpucu…' : 'İpucu'}
        </button>
      )}
      {p.vsBot && (
        <button onClick={p.onDraw} disabled={p.over || p.setupPending}>
          Beraberlik teklif et
        </button>
      )}
      {!p.watching && (
        <button onClick={p.onResign} disabled={p.over || p.setupPending}>
          Teslim ol
        </button>
      )}
      {p.watching && (
        <>
          <button onClick={() => p.onRun(p.run === 'play' ? 'pause' : 'play')} disabled={p.over}>
            {p.run === 'play' ? '❚❚ Duraklat' : '▶ Devam'}
          </button>
          <button onClick={() => p.onRun('step')} disabled={p.run !== 'pause' || p.over || !p.atEnd}>
            Adım ▶|
          </button>
        </>
      )}
      <button onClick={p.onFlip}>Tahtayı çevir</button>
      {p.highlightLabel && (
        <button onClick={p.onToggleHighlight} aria-pressed={p.showHighlight}>
          {p.highlightLabel}: {p.showHighlight ? 'açık' : 'kapalı'}
        </button>
      )}
      <button onClick={p.onCopy}>{p.copied ? 'Kopyalandı ✓' : 'Konumu kopyala'}</button>
    </div>
  );
}
