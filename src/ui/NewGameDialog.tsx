import { useRef, useState } from 'react';
import { LEVELS } from '../ai/levels.ts';
import { TIME_CONTROLS } from '../clock/clock.ts';
import { listVariants } from '../engine/index.ts';
import { BOT_DELAYS, MODE_NAMES } from './settings.ts';
import type { GameSettings, Mode } from './settings.ts';
import { useDialogFocus } from './useDialogFocus.ts';

interface Props {
  initial: GameSettings;
  onStart: (settings: GameSettings) => void;
  onCancel?: () => void;
}

function LevelSelect({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {LEVELS.map((l) => (
          <option key={l.level} value={l.level}>
            {l.level} – {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Yeni oyun" screen: mode, variant, bot options. */
export function NewGameDialog({ initial, onStart, onCancel }: Props) {
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus(dialogRef, onCancel);
  const [s, setS] = useState(initial);
  const set = (patch: Partial<GameSettings>) => setS((prev) => ({ ...prev, ...patch }));

  return (
    <div className="modal-backdrop screen" onClick={onCancel}>
      <form
        className="modal new-game"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Yeni oyun"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onStart(s);
        }}
      >
        <h2>Yeni oyun</h2>

        <fieldset className="choice-row">
          <legend>Mod</legend>
          {(Object.keys(MODE_NAMES) as Mode[]).map((m) => (
            <label key={m} className={s.mode === m ? 'chip on' : 'chip'}>
              <input type="radio" name="mode" checked={s.mode === m} onChange={() => set({ mode: m })} />
              {MODE_NAMES[m]}
            </label>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>Varyant</legend>
          {listVariants().map((v) => (
            <label key={v.id} className={s.variantId === v.id ? 'chip on' : 'chip'}>
              <input
                type="radio"
                name="variant"
                checked={s.variantId === v.id}
                onChange={() => set({ variantId: v.id })}
              />
              {v.name}
            </label>
          ))}
        </fieldset>

        {s.mode === 'bot' && (
          <div className="field-grid">
            <LevelSelect label="Seviye" value={s.botLevel} onChange={(n) => set({ botLevel: n })} />
            <label className="field">
              <span>Rengin</span>
              <select
                value={s.humanColor}
                onChange={(e) => set({ humanColor: e.target.value as GameSettings['humanColor'] })}
              >
                <option value="w">Beyaz</option>
                <option value="b">Siyah</option>
                <option value="random">Rastgele</option>
              </select>
            </label>
          </div>
        )}

        {s.mode === 'botvbot' && (
          <div className="field-grid">
            <LevelSelect label="Beyaz seviyesi" value={s.whiteLevel} onChange={(n) => set({ whiteLevel: n })} />
            <LevelSelect label="Siyah seviyesi" value={s.blackLevel} onChange={(n) => set({ blackLevel: n })} />
            <label className="field">
              <span>Hamleler arası</span>
              <select value={s.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })}>
                {BOT_DELAYS.map((d) => (
                  <option key={d} value={d}>
                    {(d / 1000).toLocaleString('tr-TR')} sn
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <fieldset className="choice-row">
          <legend>Süre (dakika + hamle başı artış saniye)</legend>
          {TIME_CONTROLS.map((t) => (
            <label key={t.id} className={s.timeControl === t.id ? 'chip on' : 'chip'}>
              <input
                type="radio"
                name="time"
                checked={s.timeControl === t.id}
                onChange={() => set({ timeControl: t.id })}
              />
              {t.label}
            </label>
          ))}
        </fieldset>

        <div className="modal-actions">
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Vazgeç
            </button>
          )}
          <button type="submit" className="primary">
            Oyuna başla
          </button>
        </div>
      </form>
    </div>
  );
}
