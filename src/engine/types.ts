import type { RuleCard } from '../rules/cards.ts';

// Core engine types. This module (and the whole engine folder) must stay free of
// React / DOM imports so it can run unchanged on a server.

export type Color = 'w' | 'b';

/** Piece type id. Open-ended so variants can add new pieces ('u', 'j', ...). */
export type PieceType = string;

export interface Piece {
  readonly type: PieceType;
  readonly color: Color;
}

/** Square index 0..63; a1 = 0, b1 = 1, ..., h8 = 63. */
export type Square = number;

export type CastleSide = 'K' | 'Q';

export interface Move {
  readonly from: Square;
  readonly to: Square;
  /** Type of the piece that moves. */
  readonly piece: PieceType;
  /** Type of the captured piece, if any. */
  readonly captured?: PieceType;
  readonly promotion?: PieceType;
  readonly castle?: CastleSide;
  readonly enPassant?: boolean;
  readonly doublePush?: boolean;
}

export interface CastlingRights {
  readonly wK: boolean;
  readonly wQ: boolean;
  readonly bK: boolean;
  readonly bQ: boolean;
}

/** Variant-specific state (e.g. Jester's "last moved piece" memory). Must be plain data. */
export type VariantExtra = Readonly<Record<string, unknown>>;

export interface Position {
  readonly board: ReadonlyArray<Piece | null>;
  readonly turn: Color;
  readonly castling: CastlingRights;
  /** En passant target square (the square passed over), or null. */
  readonly ep: Square | null;
  /** Half-move clock for the 50-move rule. */
  readonly halfmove: number;
  readonly fullmove: number;
  readonly extra: VariantExtra;
}

export type GameEndReason = 'checkmate' | 'stalemate' | 'fifty-move' | 'threefold' | 'insufficient';

export interface GameResult {
  readonly reason: GameEndReason;
  /** Winner color, or null for draws. */
  readonly winner: Color | null;
}

export interface PlayedMove {
  readonly move: Move;
  readonly san: string;
}

export interface GameState {
  readonly variantId: string;
  readonly position: Position;
  /** Position keys (see positionKey) of every position reached, including the current one. */
  readonly history: readonly string[];
  readonly moves: readonly PlayedMove[];
  /** Previous state, for undo. */
  readonly previous: GameState | null;
  readonly result: GameResult | null;
}

// ---------------------------------------------------------------------------
// Movement patterns

/** [fileDelta, rankDelta] */
export type Dir = readonly [number, number];

export type MovePattern =
  /** Slides any distance along each direction until blocked (rook / bishop / queen). */
  | { readonly kind: 'slide'; readonly dirs: readonly Dir[] }
  /** Single jump/step by each offset (knight / king). */
  | { readonly kind: 'step'; readonly dirs: readonly Dir[] }
  /** Pawn-like: forward push to empty square, diagonal-forward capture. */
  | {
      readonly kind: 'pawn';
      readonly doublePush: boolean;
      readonly enPassant: boolean;
      readonly promotion: boolean;
    };

// ---------------------------------------------------------------------------
// Piece & variant definitions

/** Purely visual data; rendered by the UI without any variant-specific code. */
export type PieceIcon =
  | { readonly kind: 'glyph'; readonly glyph: string }
  | { readonly kind: 'svg'; readonly svg: (color: Color) => string };

export interface PieceBadge {
  readonly label: string;
  readonly title: string;
}

export interface PieceDefinition {
  readonly type: PieceType;
  /** Turkish display name. */
  readonly name: string;
  /** Lowercase FEN letter (uppercase = white). */
  readonly fenChar: string;
  /** Letter used in SAN ('' for pawns). */
  readonly sanLetter: string;
  /** Movement patterns; may depend on the position (e.g. Jester). */
  readonly patterns: (pos: Position, color: Color) => readonly MovePattern[];
  /** Royal pieces must never be left capturable (the king). */
  readonly royal?: boolean;
  /** Piece can castle (standard king). */
  readonly castles?: boolean;
  readonly canCapture: boolean;
  readonly capturable: boolean;
  /** For insufficient-material detection: 'none' pieces are ignored, a lone 'minor' cannot mate. */
  readonly material: 'none' | 'minor' | 'major';
  readonly icon: PieceIcon;
  /** Optional small label drawn on the piece (e.g. Jester's current form). */
  readonly badge?: (pos: Position, color: Color) => PieceBadge | null;
  /** Optional: is the piece on `square` currently without effect (the UI draws it faded)? */
  readonly inactive?: (pos: Position, square: Square) => boolean;
}

export interface SetupOption {
  readonly id: string;
  readonly label: string;
  /** Optional piece shown next to the label. */
  readonly icon?: Piece;
}

/** A choice made before the game starts (e.g. which piece becomes the Jester). */
export interface SetupQuestion {
  readonly id: string;
  /** Player who answers, or null if not tied to a side. */
  readonly color: Color | null;
  readonly title: string;
  readonly options: readonly SetupOption[];
  readonly defaultOption: string;
}

export interface VariantSetup {
  /** Asked in order. */
  readonly questions: readonly SetupQuestion[];
  /** FEN-like start position for the given answers (question id -> option id). */
  readonly startPosition: (answers: Readonly<Record<string, string>>) => string;
}

export interface VariantDefinition {
  readonly id: string;
  readonly name: string;
  /** Short rule description lines (Turkish). */
  readonly description: readonly string[];
  /** FEN-like start position (with default setup answers, if the variant has a setup). */
  readonly startPosition: string;
  /** Optional pre-game choices that change the start position. */
  readonly setup?: VariantSetup;
  readonly pieces: Readonly<Record<PieceType, PieceDefinition>>;
  /** Piece types used by this variant. */
  readonly pieceTypes: readonly PieceType[];
  /** Pieces a pawn may promote to, in UI order. */
  readonly promotionTypes: readonly PieceType[];
  readonly isCapturable: (piece: Piece) => boolean;
  readonly canCapture: (piece: Piece) => boolean;
  /**
   * Optional position-dependent capture rule, checked after the static
   * canCapture/isCapturable rules, both when generating captures and when
   * computing attacks (so it also decides check). `victimSquare` is where the
   * captured piece stands (differs from the destination for en passant).
   * `victim` is the piece that would be captured there.
   */
  readonly captureAllowed?: (pos: Position, from: Square, victimSquare: Square, attacker: Piece, victim: Piece) => boolean;
  /**
   * Optional squares the UI may highlight (e.g. zones of effect), with a toggle
   * label. `ranks` (0-based) are board rows the UI marks faintly as the area
   * where the effect can occur.
   */
  readonly highlight?: {
    readonly label: string;
    readonly squares: (pos: Position) => readonly Square[];
    readonly ranks?: readonly number[];
  };
  /**
   * Material values in centipawns, per piece type (used by the bot's evaluation).
   * Kings are 0: mate is scored separately.
   */
  readonly pieceValues: Readonly<Record<PieceType, number>>;
  /**
   * Optional variant-specific evaluation term in centipawns for `color` in `pos`
   * (e.g. Diplomat zone bonus). Positive = good for `color`.
   */
  readonly evaluateExtra?: (pos: Position, color: Color) => number;
  /** Rule card shown before a game (see src/rules/cards.ts). */
  readonly rules: RuleCard;
  /** Initial variant extra state. */
  readonly initialExtra: () => VariantExtra;
  /** Compute the extra state after `move` is played from `pos`. */
  readonly afterMove?: (pos: Position, move: Move) => VariantExtra;
  /** Extra-state part of the position hash (repetition). */
  readonly hashExtra?: (pos: Position) => string;
  /** Extra-state FEN field (7th field). Return null for no field. */
  readonly serializeExtra?: (extra: VariantExtra) => string | null;
  readonly parseExtra?: (field: string | undefined) => VariantExtra;
  /**
   * Optional override of pseudo-legal move generation for one square.
   * `base` is the default generator; return its result to keep default behavior.
   */
  readonly generateMoves?: (pos: Position, from: Square, base: (pos: Position, from: Square) => Move[]) => Move[];
  /**
   * Optional game-over override. Receives the default result (null = game continues)
   * and may replace it.
   */
  readonly isGameOver?: (state: GameState, defaultResult: GameResult | null) => GameResult | null;
}
