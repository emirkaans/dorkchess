import { useRef, useEffect, useState } from 'react';
import type { VariantDefinition } from '../engine/index.ts';
import { Diagram } from './Diagram.tsx';
import { useI18n } from './i18n.tsx';
import { isRuleCardHidden, setRuleCardHidden } from './settings.ts';
import { useDialogFocus } from './useDialogFocus.ts';

interface Props {
  variant: VariantDefinition;
  onClose: () => void;
}

const AUTOPLAY_MS = 2000;

/** The variant's rule card: summary, bullets and example diagrams (prev/next, autoplay). */
export function RuleCardModal({ variant, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const { t, vt } = useI18n();
  const { rules } = vt(variant);
  const examples = rules.examples;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(examples.length > 1);
  const [hidden, setHidden] = useState(() => isRuleCardHidden(variant.id));

  useEffect(() => {
    if (!playing || examples.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % examples.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [playing, examples.length]);

  const go = (delta: number) => {
    setPlaying(false);
    setIndex((i) => (i + delta + examples.length) % examples.length);
  };

  const example = examples[index];

  return (
    <div className="modal-backdrop screen" onClick={onClose}>
      <div
        className="modal rule-card"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={t('rules.title', { title: rules.title })}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{rules.title}</h2>
        <p className="summary">{rules.summary}</p>
        <ul className="rules">
          {rules.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>

        {example && (
          <figure className="example">
            <Diagram variant={variant} example={example} size={260} />
            <figcaption>
              <span className="muted">{t('rules.example', { i: index + 1, n: examples.length })}</span>{' '}
              {example.caption}
            </figcaption>
            <div className="example-controls">
              <button type="button" onClick={() => go(-1)} aria-label={t('rules.previous')}>
                ◀
              </button>
              <button type="button" onClick={() => setPlaying((p) => !p)}>
                {playing ? t('rules.stop') : t('rules.play')}
              </button>
              <button type="button" onClick={() => go(1)} aria-label={t('rules.next')}>
                ▶
              </button>
            </div>
          </figure>
        )}

        <label className="dont-show">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => {
              setHidden(e.target.checked);
              setRuleCardHidden(variant.id, e.target.checked);
            }}
          />
          {t('rules.dontShow')}
        </label>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose} data-autofocus>
            {t('rules.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
