// Rule card data types. The content lives in each variant definition (`rules`);
// the UI renders cards generically. No React / DOM imports here.

/** One example diagram on a rule card. Squares are written in algebraic notation ("e4"). */
export interface RuleExample {
  /** Position in the engine's FEN-like format (must parse for the variant). */
  readonly fen: string;
  /** Squares to emphasize. */
  readonly highlights: readonly string[];
  /** Arrows as [from, to] square pairs. */
  readonly arrows: readonly (readonly [string, string])[];
  readonly caption: string;
}

export interface RuleCard {
  readonly title: string;
  /** One or two sentences. */
  readonly summary: string;
  /** At most 6 short bullets. */
  readonly bullets: readonly string[];
  readonly examples: readonly RuleExample[];
}
