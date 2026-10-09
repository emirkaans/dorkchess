// A variant's texts in the chosen language. The variant definition holds the
// Turkish texts; `translations[locale]` overrides them field by field.

import type {
  Color,
  PieceBadge,
  PieceType,
  Position,
  SetupQuestion,
  VariantDefinition,
  VariantTexts,
} from '../engine/index.ts';
import type { RuleCard } from '../rules/cards.ts';
import type { Locale } from './index.ts';

export interface LocalizedVariant {
  readonly name: string;
  readonly description: readonly string[];
  readonly rules: RuleCard;
  readonly highlightLabel: string | null;
  pieceName(type: PieceType): string;
  badge(type: PieceType, pos: Position, color: Color): PieceBadge | null;
  question(q: SetupQuestion): SetupQuestion;
}

const NONE: VariantTexts = {};

export function variantTexts(v: VariantDefinition, locale: Locale): LocalizedVariant {
  const t = v.translations?.[locale] ?? NONE;
  const rules: RuleCard = t.rules
    ? {
        title: t.rules.title,
        summary: t.rules.summary,
        bullets: t.rules.bullets,
        examples: v.rules.examples.map((ex, i) => ({ ...ex, caption: t.rules?.captions[i] ?? ex.caption })),
      }
    : v.rules;
  return {
    name: t.name ?? v.name,
    description: t.description ?? v.description,
    rules,
    highlightLabel: v.highlight ? (t.highlightLabel ?? v.highlight.label) : null,
    pieceName: (type) => t.pieceNames?.[type] ?? v.pieces[type]?.name ?? type,
    badge: (type, pos, color) => {
      const fn = t.badges?.[type] ?? v.pieces[type]?.badge;
      return fn ? fn(pos, color) : null;
    },
    question: (q) => {
      const qt = t.setup?.[q.id];
      if (!qt) return q;
      return { ...q, title: qt.title, options: q.options.map((o) => ({ ...o, label: qt.options[o.id] ?? o.label })) };
    },
  };
}
