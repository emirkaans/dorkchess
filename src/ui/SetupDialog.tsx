import type { SetupQuestion, VariantDefinition } from '../engine/index.ts';
import { PieceView } from './PieceView.tsx';

interface Props {
  variant: VariantDefinition;
  question: SetupQuestion;
  step: number;
  total: number;
  onPick: (optionId: string) => void;
}

/** Pre-game choice dialog; driven entirely by the variant's setup questions. */
export function SetupDialog({ variant, question, step, total, onPick }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal setup" role="dialog" aria-label={question.title}>
        <p>
          {question.title}
          {total > 1 && (
            <span className="muted">
              {' '}
              ({step + 1}/{total})
            </span>
          )}
        </p>
        <div className="setup-options">
          {question.options.map((o) => (
            <button
              key={o.id}
              className={o.id === question.defaultOption ? 'setup-option default' : 'setup-option'}
              onClick={() => onPick(o.id)}
            >
              {o.icon && (
                <span className="setup-icon">
                  <PieceView variant={variant} piece={o.icon} />
                </span>
              )}
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
