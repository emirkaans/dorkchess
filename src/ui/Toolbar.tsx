import { BOARD_THEMES, UI_MODES } from './prefs.ts';
import type { BoardTheme, Prefs, UiMode } from './prefs.ts';

interface Props {
  label: string;
  prefs: Prefs;
  onPrefs: (update: (p: Prefs) => Prefs) => void;
  onRules: () => void;
  onHistory: () => void;
  onNewGame: () => void;
}

/** Top bar: game label, rules, history, theme / interface / sound preferences, new game. */
export function Toolbar({ label, prefs, onPrefs, onRules, onHistory, onNewGame }: Props) {
  return (
    <header className="toolbar">
      <h1>dorkchess</h1>
      <span className="muted game-label">{label}</span>
      <button onClick={onRules}>Kurallar</button>
      <button onClick={onHistory}>Geçmiş</button>
      <label className="pref">
        Tema{' '}
        <select
          value={prefs.boardTheme}
          onChange={(e) => onPrefs((p) => ({ ...p, boardTheme: e.target.value as BoardTheme }))}
        >
          {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((t) => (
            <option key={t} value={t}>
              {BOARD_THEMES[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="pref">
        Arayüz{' '}
        <select value={prefs.ui} onChange={(e) => onPrefs((p) => ({ ...p, ui: e.target.value as UiMode }))}>
          {(Object.keys(UI_MODES) as UiMode[]).map((m) => (
            <option key={m} value={m}>
              {UI_MODES[m]}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => onPrefs((p) => ({ ...p, sound: !p.sound }))}
        aria-pressed={prefs.sound}
        title={prefs.sound ? 'Sesi kapat' : 'Sesi aç'}
      >
        {prefs.sound ? '🔊 Ses' : '🔇 Sessiz'}
      </button>
      <button onClick={onNewGame}>Yeni oyun</button>
    </header>
  );
}
