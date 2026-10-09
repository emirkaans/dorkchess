import { useRef, useState } from 'react';
import { LEVELS } from '../ai/levels.ts';
import { TIME_CONTROLS } from '../clock/clock.ts';
import { listVariants } from '../engine/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { useI18n } from './i18n.tsx';
import { BOT_DELAYS, MODES } from './settings.ts';
import type { GameSettings } from './settings.ts';
import { useDialogFocus } from './useDialogFocus.ts';

interface Props {
  initial: GameSettings;
  onStart: (settings: GameSettings) => void;
  onCancel?: () => void;
}

function LevelSelect({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {LEVELS.map((l) => (
          <option key={l.level} value={l.level}>
            {l.level} – {t(`level.${l.level}` as MessageKey)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** New game screen: mode, variant, bot options, time control. */
export function NewGameDialog({ initial, onStart, onCancel }: Props) {
  const { t, vt, locale } = useI18n();
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
        aria-label={t('newGame.title')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onStart(s);
        }}
      >
        <h2>{t('newGame.title')}</h2>

        <fieldset className="choice-row">
          <legend>{t('newGame.mode')}</legend>
          {MODES.map((m) => (
            <label key={m} className={s.mode === m ? 'chip on' : 'chip'}>
              <input type="radio" name="mode" checked={s.mode === m} onChange={() => set({ mode: m })} />
              {t(`mode.${m}`)}
            </label>
          ))}
        </fieldset>

        <fieldset className="choice-row">
          <legend>{t('newGame.variant')}</legend>
          {listVariants().map((v) => (
            <label key={v.id} className={s.variantId === v.id ? 'chip on' : 'chip'}>
              <input
                type="radio"
                name="variant"
                checked={s.variantId === v.id}
                onChange={() => set({ variantId: v.id })}
              />
              {vt(v).name}
            </label>
          ))}
        </fieldset>

        {s.mode === 'bot' && (
          <div className="field-grid">
            <LevelSelect label={t('newGame.level')} value={s.botLevel} onChange={(n) => set({ botLevel: n })} />
            <label className="field">
              <span>{t('newGame.yourColor')}</span>
              <select
                value={s.humanColor}
                onChange={(e) => set({ humanColor: e.target.value as GameSettings['humanColor'] })}
              >
                <option value="w">{t('color.w')}</option>
                <option value="b">{t('color.b')}</option>
                <option value="random">{t('newGame.random')}</option>
              </select>
            </label>
          </div>
        )}

        {s.mode === 'botvbot' && (
          <div className="field-grid">
            <LevelSelect
              label={t('newGame.whiteLevel')}
              value={s.whiteLevel}
              onChange={(n) => set({ whiteLevel: n })}
            />
            <LevelSelect
              label={t('newGame.blackLevel')}
              value={s.blackLevel}
              onChange={(n) => set({ blackLevel: n })}
            />
            <label className="field">
              <span>{t('newGame.delay')}</span>
              <select value={s.delayMs} onChange={(e) => set({ delayMs: Number(e.target.value) })}>
                {BOT_DELAYS.map((d) => (
                  <option key={d} value={d}>
                    {t('newGame.seconds', { n: (d / 1000).toLocaleString(locale) })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <fieldset className="choice-row">
          <legend>{t('newGame.time')}</legend>
          {TIME_CONTROLS.map((tc) => (
            <label key={tc.id} className={s.timeControl === tc.id ? 'chip on' : 'chip'}>
              <input
                type="radio"
                name="time"
                checked={s.timeControl === tc.id}
                onChange={() => set({ timeControl: tc.id })}
              />
              {tc.initialMs === null ? t('time.none') : tc.label}
            </label>
          ))}
        </fieldset>

        <div className="modal-actions">
          {onCancel && (
            <button type="button" onClick={onCancel}>
              {t('newGame.cancel')}
            </button>
          )}
          <button type="submit" className="primary">
            {t('newGame.start')}
          </button>
        </div>
      </form>
    </div>
  );
}
