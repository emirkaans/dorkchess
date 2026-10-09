// Fast, mutable board for the bot's search: make/unmake instead of copying,
// incremental Zobrist hashing, piece lists and precomputed step tables.
// It is compiled from a VariantDefinition, so it plays every variant; rules
// that piece data can't express come from the variant's `fast` hooks. The
// immutable engine stays the reference: tests compare the two move for move.

import { makeSquare } from '../board.ts';
import type { Dir, MovePattern, PieceType, Position, VariantDefinition } from '../types.ts';
import type { FastHooks, Side } from './hooks.ts';

// ---------------------------------------------------------------------------
// Moves are plain ints: from | to << 6 | (promotion type + 1) << 12 | flag << 16

export const FLAG_DOUBLE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE_K = 3;
export const FLAG_CASTLE_Q = 4;

export const moveFrom = (m: number) => m & 63;
export const moveTo = (m: number) => (m >> 6) & 63;
/** Promotion type index, or -1. */
export const movePromo = (m: number) => ((m >> 12) & 15) - 1;
export const moveFlag = (m: number) => m >> 16;
const encode = (from: number, to: number, promo: number, flag: number) => from | (to << 6) | ((promo + 1) << 12) | (flag << 16);

/** Piece code: +(type+1) for white, -(type+1) for black, 0 = empty. */
export const codeSide = (c: number): Side => (c > 0 ? 0 : 1);
export const codeType = (c: number) => (c > 0 ? c : -c) - 1;
const makeCode = (type: number, side: Side) => (side === 0 ? type + 1 : -(type + 1));

// ---------------------------------------------------------------------------
// Step tables: STEP(dir)[sq] = square reached by one step, or -1

const stepCache = new Map<number, Int8Array>();
export function stepTable([dx, dy]: Dir): Int8Array {
  const key = (dx + 16) * 64 + (dy + 16);
  let t = stepCache.get(key);
  if (!t) {
    t = new Int8Array(64);
    for (let sq = 0; sq < 64; sq++) {
      const f = (sq & 7) + dx;
      const r = (sq >> 3) + dy;
      t[sq] = f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
    }
    stepCache.set(key, t);
  }
  return t;
}

/** A movement pattern prepared for fast generation (cached per pattern object). */
interface Compiled {
  readonly kind: 0 | 1 | 2; // slide, step, pawn
  readonly tables: readonly Int8Array[];
  /** Pawn only, per side: push table and the two capture tables. */
  readonly push: readonly [Int8Array, Int8Array];
  readonly caps: readonly [readonly Int8Array[], readonly Int8Array[]];
  readonly doublePush: boolean;
  readonly enPassant: boolean;
  readonly promotion: boolean;
}

const compiledCache = new WeakMap<MovePattern, Compiled>();
const compiledListCache = new WeakMap<readonly MovePattern[], readonly Compiled[]>();
/** Compiled form of a pattern list (cached: hooks return shared constant arrays). */
function compileList(list: readonly MovePattern[]): readonly Compiled[] {
  let c = compiledListCache.get(list);
  if (!c) {
    c = list.map(compile);
    compiledListCache.set(list, c);
  }
  return c;
}
function compile(p: MovePattern): Compiled {
  let c = compiledCache.get(p);
  if (c) return c;
  const none: readonly [Int8Array, Int8Array] = [new Int8Array(0), new Int8Array(0)];
  if (p.kind === 'pawn') {
    c = {
      kind: 2,
      tables: [],
      push: [stepTable([0, 1]), stepTable([0, -1])],
      caps: [
        [stepTable([-1, 1]), stepTable([1, 1])],
        [stepTable([-1, -1]), stepTable([1, -1])],
      ],
      doublePush: !!p.doublePush,
      enPassant: !!p.enPassant,
      promotion: !!p.promotion,
    };
  } else {
    c = {
      kind: p.kind === 'slide' ? 0 : 1,
      tables: p.dirs.map(stepTable),
      push: none,
      caps: [[], []],
      doublePush: false,
      enPassant: false,
      promotion: false,
    };
  }
  compiledCache.set(p, c);
  return c;
}

export interface FastType {
  readonly index: number;
  readonly letter: PieceType;
  readonly canCapture: boolean;
  readonly capturable: boolean;
  readonly royal: boolean;
  readonly castles: boolean;
  readonly material: 'none' | 'minor' | 'major';
  readonly isPawn: boolean;
  readonly dynamic: boolean;
  /** Static patterns per side (empty for dynamic types). */
  readonly patterns: readonly [readonly Compiled[], readonly Compiled[]];
}

/** Reverse-attack entry: walk `back` from the target; a piece whose type bit is in `mask` attacks it. */
interface AttackEntry {
  readonly back: Int8Array;
  readonly mask: number;
  readonly slide: boolean;
}

// ---------------------------------------------------------------------------
// Zobrist keys (two 32-bit halves; low half indexes the table, high half verifies)

function rand32(seed: { s: number }): number {
  seed.s = (seed.s + 0x6d2b79f5) | 0;
  let t = seed.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) | 0;
}

const MAX_STACK = 1024;

export class FastBoard {
  readonly v: VariantDefinition;
  readonly hooks: FastHooks;
  readonly types: readonly FastType[];
  readonly typeIndex: ReadonlyMap<PieceType, number>;
  readonly promoTypes: readonly number[];
  private readonly rookType: number;
  private readonly dynamicTypes: readonly number[];
  private readonly royalTypes: readonly number[];
  private readonly attackEntries: readonly [readonly AttackEntry[], readonly AttackEntry[]];

  // --- position ---
  readonly sq = new Int8Array(64);
  side: Side = 0;
  /** Castling rights bits: 1 wK, 2 wQ, 4 bK, 8 bQ. */
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  readonly extra: Int32Array;
  hashLo = 0;
  hashHi = 0;
  /** Zobrist key of the pawns alone (for the evaluation's pawn cache). */
  pawnKey = 0;
  private readonly pawnType: number;

  // --- incremental evaluation terms (see useEval): White minus Black ---
  private psqMg: Int16Array | null = null;
  private psqEg: Int16Array | null = null;
  private phaseW: Int8Array | null = null;
  /** Sum of mid-game / end-game piece-square values, White minus Black. */
  mg = 0;
  eg = 0;
  /** Sum of the pieces' game-phase weights. */
  phase = 0;

  // --- piece lists: per slot (type * 2 + side) ---
  private readonly listSq: Int8Array[];
  readonly listCount: Uint8Array;
  private readonly listIdx = new Int8Array(64);

  // --- undo stack ---
  ply = 0;
  private readonly uMove = new Int32Array(MAX_STACK);
  private readonly uCaptured = new Int8Array(MAX_STACK);
  private readonly uMover = new Int8Array(MAX_STACK);
  private readonly uCastling = new Uint8Array(MAX_STACK);
  private readonly uEp = new Int8Array(MAX_STACK);
  private readonly uHalf = new Int16Array(MAX_STACK);
  private readonly uHashLo = new Int32Array(MAX_STACK);
  private readonly uHashHi = new Int32Array(MAX_STACK);
  private readonly uExtra: Int32Array;

  // --- zobrist ---
  private readonly zPieceLo: Int32Array;
  private readonly zPieceHi: Int32Array;
  private readonly zCastleLo = new Int32Array(16);
  private readonly zCastleHi = new Int32Array(16);
  private readonly zEpLo = new Int32Array(8);
  private readonly zEpHi = new Int32Array(8);
  private zSideLo = 0;
  private zSideHi = 0;

  constructor(v: VariantDefinition) {
    this.v = v;
    this.hooks = v.fast ?? {};
    const letters = v.pieceTypes;
    if (letters.length > 15) throw new Error('FastBoard: too many piece types');
    const dynamic = new Set(this.hooks.dynamicTypes ?? []);
    // Static patterns: asked once with a dummy position (pattern functions of static types ignore it).
    const dummy = { board: [], turn: 'w', castling: { wK: false, wQ: false, bK: false, bQ: false }, ep: null, halfmove: 0, fullmove: 1, extra: v.initialExtra() } as unknown as Position;
    this.types = letters.map((letter, index) => {
      const def = v.pieces[letter];
      const isDyn = dynamic.has(letter);
      return {
        index,
        letter,
        canCapture: v.canCapture({ type: letter, color: 'w' }),
        capturable: v.isCapturable({ type: letter, color: 'w' }),
        royal: !!def.royal,
        castles: !!def.castles,
        material: def.material,
        isPawn: letter === 'p',
        dynamic: isDyn,
        patterns: isDyn
          ? [[], []]
          : [def.patterns(dummy, 'w').map(compile), def.patterns(dummy, 'b').map(compile)],
      } satisfies FastType;
    });
    this.typeIndex = new Map(letters.map((l, i) => [l, i]));
    this.promoTypes = v.promotionTypes.map((t) => this.typeIndex.get(t)!);
    this.rookType = this.typeIndex.get('r') ?? -1;
    this.pawnType = this.typeIndex.get('p') ?? -1;
    this.dynamicTypes = this.types.filter((t) => t.dynamic).map((t) => t.index);
    this.royalTypes = this.types.filter((t) => t.royal).map((t) => t.index);
    this.attackEntries = [this.buildAttacks(0), this.buildAttacks(1)];

    const slots = letters.length * 2;
    this.listSq = Array.from({ length: slots }, () => new Int8Array(64));
    this.listCount = new Uint8Array(slots);
    const slotsExtra = this.hooks.extraSlots ?? 0;
    this.extra = new Int32Array(slotsExtra);
    this.uExtra = new Int32Array(MAX_STACK * Math.max(1, slotsExtra));

    const seed = { s: 0x1234567 };
    this.zPieceLo = new Int32Array(slots * 64);
    this.zPieceHi = new Int32Array(slots * 64);
    for (let i = 0; i < slots * 64; i++) {
      this.zPieceLo[i] = rand32(seed);
      this.zPieceHi[i] = rand32(seed);
    }
    for (let i = 0; i < 16; i++) {
      this.zCastleLo[i] = i === 0 ? 0 : rand32(seed);
      this.zCastleHi[i] = i === 0 ? 0 : rand32(seed);
    }
    for (let i = 0; i < 8; i++) {
      this.zEpLo[i] = rand32(seed);
      this.zEpHi[i] = rand32(seed);
    }
    this.zSideLo = rand32(seed);
    this.zSideHi = rand32(seed);
  }

  /** Reverse-attack tables of the static capturing types of `side`. */
  private buildAttacks(side: Side): AttackEntry[] {
    const byKey = new Map<string, { back: Int8Array; mask: number; slide: boolean }>();
    for (const t of this.types) {
      if (t.dynamic || !t.canCapture) continue;
      for (const p of t.patterns[side]) {
        const add = (dir: Dir, slide: boolean) => {
          const key = `${slide ? 's' : 'j'}${dir[0]},${dir[1]}`;
          const e = byKey.get(key) ?? { back: stepTable([-dir[0], -dir[1]]), mask: 0, slide };
          e.mask |= 1 << t.index;
          byKey.set(key, e);
        };
        if (p.kind === 2) {
          const fw = side === 0 ? 1 : -1;
          add([-1, fw], false);
          add([1, fw], false);
        } else {
          // Recover the dirs from the tables: each table is stepTable(dir).
          for (const table of p.tables) add(dirOf(table), p.kind === 0);
        }
      }
    }
    return [...byKey.values()];
  }

  // -------------------------------------------------------------------------
  // Setup

  /**
   * Piece-square tables indexed [(type * 2 + side) * 64 + square], kept summed
   * incrementally through every move (mg / eg / phase).
   */
  useEval(mg: Int16Array, eg: Int16Array, phase: Int8Array): void {
    this.psqMg = mg;
    this.psqEg = eg;
    this.phaseW = phase;
    this.mg = this.eg = this.phase = 0;
    for (let s = 0; s < 64; s++) if (this.sq[s]) this.addTerms(s, this.sq[s], 1);
  }

  private addTerms(s: number, code: number, k: 1 | -1): void {
    const z = this.slot(code) * 64 + s;
    const sign = code > 0 ? k : -k;
    this.mg += sign * this.psqMg![z];
    this.eg += sign * this.psqEg![z];
    this.phase += k * this.phaseW![codeType(code)];
  }

  load(pos: Position): this {
    this.sq.fill(0);
    this.listCount.fill(0);
    this.mg = this.eg = this.phase = 0;
    this.pawnKey = 0;
    this.ply = 0;
    for (let s = 0; s < 64; s++) {
      const p = pos.board[s];
      if (!p) continue;
      const type = this.typeIndex.get(p.type);
      if (type === undefined) throw new Error(`FastBoard: unknown piece ${p.type}`);
      this.put(s, makeCode(type, p.color === 'w' ? 0 : 1));
    }
    this.side = pos.turn === 'w' ? 0 : 1;
    const c = pos.castling;
    this.castling = (c.wK ? 1 : 0) | (c.wQ ? 2 : 0) | (c.bK ? 4 : 0) | (c.bQ ? 8 : 0);
    this.ep = pos.ep ?? -1;
    this.halfmove = pos.halfmove;
    this.fullmove = pos.fullmove;
    this.extra.fill(0);
    this.hooks.readExtra?.(this, pos);
    this.rehash();
    return this;
  }

  private rehash(): void {
    let lo = 0;
    let hi = 0;
    for (let s = 0; s < 64; s++) {
      const c = this.sq[s];
      if (!c) continue;
      const z = this.slot(c) * 64 + s;
      lo ^= this.zPieceLo[z];
      hi ^= this.zPieceHi[z];
    }
    lo ^= this.zCastleLo[this.castling];
    hi ^= this.zCastleHi[this.castling];
    if (this.ep >= 0) {
      lo ^= this.zEpLo[this.ep & 7];
      hi ^= this.zEpHi[this.ep & 7];
    }
    if (this.side) {
      lo ^= this.zSideLo;
      hi ^= this.zSideHi;
    }
    this.hashLo = lo;
    this.hashHi = hi;
  }

  /** Position key low half including variant state (for the transposition table / repetition). */
  keyLo(): number {
    return this.hooks.hashExtra ? this.hashLo ^ Math.imul(this.hooks.hashExtra(this) + 1, 0x9e3779b1) : this.hashLo;
  }
  keyHi(): number {
    return this.hooks.hashExtra ? this.hashHi ^ Math.imul(this.hooks.hashExtra(this) + 7, 0x85ebca6b) : this.hashHi;
  }

  // -------------------------------------------------------------------------
  // Piece lists

  private slot(code: number): number {
    return codeType(code) * 2 + codeSide(code);
  }

  private put(s: number, code: number): void {
    this.sq[s] = code;
    const slot = this.slot(code);
    if (this.psqMg) this.addTerms(s, code, 1);
    if (codeType(code) === this.pawnType) this.pawnKey ^= this.zPieceLo[slot * 64 + s];
    const n = this.listCount[slot]++;
    this.listSq[slot][n] = s;
    this.listIdx[s] = n;
  }

  private remove(s: number): void {
    const code = this.sq[s];
    const slot = this.slot(code);
    if (this.psqMg) this.addTerms(s, code, -1);
    if (codeType(code) === this.pawnType) this.pawnKey ^= this.zPieceLo[slot * 64 + s];
    const list = this.listSq[slot];
    const last = --this.listCount[slot];
    const i = this.listIdx[s];
    const moved = list[last];
    list[i] = moved;
    this.listIdx[moved] = i;
    this.sq[s] = 0;
  }

  private shift(from: number, to: number): void {
    const code = this.sq[from];
    const slot = this.slot(code);
    if (this.psqMg) {
      this.addTerms(from, code, -1);
      this.addTerms(to, code, 1);
    }
    if (codeType(code) === this.pawnType) this.pawnKey ^= this.zPieceLo[slot * 64 + from] ^ this.zPieceLo[slot * 64 + to];
    const i = this.listIdx[from];
    this.listSq[slot][i] = to;
    this.listIdx[to] = i;
    this.sq[to] = code;
    this.sq[from] = 0;
  }

  /** Number of pieces of `type` for `side`. */
  count(type: number, side: Side): number {
    return this.listCount[type * 2 + side];
  }

  /** Squares of the pieces of `type` for `side` (valid until the next move). */
  squares(type: number, side: Side): Int8Array {
    return this.listSq[type * 2 + side];
  }

  // -------------------------------------------------------------------------
  // Patterns and capture rules

  private patternsOf(type: number, side: Side): readonly Compiled[] {
    const t = this.types[type];
    if (!t.dynamic) return t.patterns[side];
    return compileList(this.hooks.patterns!(this, t.letter, side));
  }

  /** May the piece on `from` capture the piece `victim` standing on `victimSq`? (side checks done by caller) */
  private canTake(from: number, victimSq: number, attacker: number, victim: number): boolean {
    if (!this.types[codeType(attacker)].canCapture || !this.types[codeType(victim)].capturable) return false;
    return !this.hooks.captureAllowed || this.hooks.captureAllowed(this, from, victimSq, victim);
  }

  // -------------------------------------------------------------------------
  // Attacks

  /**
   * Is `target` attacked by `by`? `victim` is the piece considered to stand on
   * `target` (default: its occupant); it feeds the variant's capture rule.
   */
  attacked(target: number, by: Side, victim: number = this.sq[target]): boolean {
    const sq = this.sq;
    const hook = this.hooks.captureAllowed;
    const entries = this.attackEntries[by];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      let s = e.back[target];
      if (e.slide) while (s >= 0 && sq[s] === 0) s = e.back[s];
      if (s < 0) continue;
      const c = sq[s];
      if (c === 0 || codeSide(c) !== by || !((e.mask >> codeType(c)) & 1)) continue;
      if (hook && victim !== 0 && !hook(this, s, target, victim)) continue;
      return true;
    }
    for (const type of this.dynamicTypes) {
      if (!this.types[type].canCapture) continue;
      const list = this.listSq[type * 2 + by];
      for (let i = this.listCount[type * 2 + by] - 1; i >= 0; i--) {
        const s = list[i];
        if (this.reaches(s, by, this.patternsOf(type, by), target)) {
          if (hook && victim !== 0 && !hook(this, s, target, victim)) continue;
          return true;
        }
      }
    }
    return false;
  }

  /** Could a piece of `side` on `from` with `patterns` capture on `target`? */
  private reaches(from: number, side: Side, patterns: readonly Compiled[], target: number): boolean {
    for (const p of patterns) {
      if (p.kind === 2) {
        const caps = p.caps[side];
        if (caps[0][from] === target || caps[1][from] === target) return true;
        continue;
      }
      for (const t of p.tables) {
        let s = t[from];
        if (p.kind === 1) {
          if (s === target) return true;
          continue;
        }
        while (s >= 0) {
          if (s === target) return true;
          if (this.sq[s] !== 0) break;
          s = t[s];
        }
      }
    }
    return false;
  }

  /** Squares the piece on `from` could move to, ignoring capture rules and legality (for mobility). */
  reachCount(from: number, side: Side): number {
    let n = 0;
    const sq = this.sq;
    for (const p of this.patternsOf(codeType(sq[from]), side)) {
      if (p.kind === 2) continue;
      for (const t of p.tables) {
        let s = t[from];
        while (s >= 0) {
          const c = sq[s];
          if (c === 0) n++;
          else {
            if (codeSide(c) !== side) n++;
            break;
          }
          if (p.kind === 1) break;
          s = t[s];
        }
      }
    }
    return n;
  }

  /** Is any royal piece of `side` attacked? */
  inCheck(side: Side = this.side): boolean {
    const other: Side = side === 0 ? 1 : 0;
    for (const type of this.royalTypes) {
      const slot = type * 2 + side;
      const list = this.listSq[slot];
      for (let i = this.listCount[slot] - 1; i >= 0; i--) if (this.attacked(list[i], other)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Move generation (pseudo-legal; legality is checked by makeMove)

  /** Writes pseudo-legal moves of the side to move into `out` from `start`; returns the new end. */
  generate(out: Int32Array, start: number, capturesOnly = false): number {
    let n = start;
    const side = this.side;
    const sq = this.sq;
    const lastRank = side === 0 ? 7 : 0;
    const startRank = side === 0 ? 1 : 6;
    for (let type = 0; type < this.types.length; type++) {
      const slot = type * 2 + side;
      const count = this.listCount[slot];
      if (!count) continue;
      const list = this.listSq[slot];
      const patterns = this.patternsOf(type, side);
      for (let i = 0; i < count; i++) {
        const from = list[i];
        const me = sq[from];
        for (const p of patterns) {
          if (p.kind === 2) {
            const push = p.push[side][from];
            if (!capturesOnly && push >= 0 && sq[push] === 0) {
              if (p.promotion && push >> 3 === lastRank) {
                for (const pt of this.promoTypes) out[n++] = encode(from, push, pt, 0);
              } else {
                out[n++] = encode(from, push, -1, 0);
                if (p.doublePush && from >> 3 === startRank) {
                  const two = p.push[side][push];
                  if (two >= 0 && sq[two] === 0) out[n++] = encode(from, two, -1, FLAG_DOUBLE);
                }
              }
            } else if (capturesOnly && push >= 0 && sq[push] === 0 && p.promotion && push >> 3 === lastRank) {
              for (const pt of this.promoTypes) out[n++] = encode(from, push, pt, 0); // promotions count as tactical
            }
            for (let k = 0; k < 2; k++) {
              const to = p.caps[side][k][from];
              if (to < 0) continue;
              const target = sq[to];
              if (target !== 0) {
                if (codeSide(target) !== side && this.canTake(from, to, me, target)) {
                  if (p.promotion && to >> 3 === lastRank) {
                    for (const pt of this.promoTypes) out[n++] = encode(from, to, pt, 0);
                  } else out[n++] = encode(from, to, -1, 0);
                }
              } else if (p.enPassant && to === this.ep) {
                const victimSq = (from & ~7) | (to & 7);
                const victim = sq[victimSq];
                if (victim !== 0 && codeSide(victim) !== side && this.canTake(from, victimSq, me, victim)) {
                  out[n++] = encode(from, to, -1, FLAG_EP);
                }
              }
            }
            continue;
          }
          const slide = p.kind === 0;
          for (const t of p.tables) {
            let to = t[from];
            while (to >= 0) {
              const target = sq[to];
              if (target === 0) {
                if (!capturesOnly) out[n++] = encode(from, to, -1, 0);
              } else {
                if (codeSide(target) !== side && this.canTake(from, to, me, target)) out[n++] = encode(from, to, -1, 0);
                break;
              }
              if (!slide) break;
              to = t[to];
            }
          }
        }
        if (!capturesOnly && this.types[type].castles) n = this.castles(out, n, from, side);
      }
    }
    return n;
  }

  private castles(out: Int32Array, n: number, from: number, side: Side): number {
    const rank = side === 0 ? 0 : 7;
    if (from !== makeSquare(4, rank) || this.rookType < 0) return n;
    const rights = this.castling >> (side * 2);
    if (!(rights & 3)) return n;
    const other: Side = side === 0 ? 1 : 0;
    const king = this.sq[from];
    const rook = makeCode(this.rookType, side);
    let inCheck = -1;
    const sides: [number, number, number[], number, number][] = [
      [1, 7, [5, 6], 5, FLAG_CASTLE_K],
      [2, 0, [1, 2, 3], 3, FLAG_CASTLE_Q],
    ];
    for (const [bit, rookFile, between, transit, flag] of sides) {
      if (!(rights & bit)) continue;
      if (this.sq[makeSquare(rookFile, rank)] !== rook) continue;
      if (between.some((f) => this.sq[makeSquare(f, rank)] !== 0)) continue;
      if (inCheck < 0) inCheck = this.attacked(from, other) ? 1 : 0;
      if (inCheck) return n;
      // Destination safety is verified by the legality check.
      if (this.attacked(makeSquare(transit, rank), other, king)) continue;
      out[n++] = encode(from, makeSquare(flag === FLAG_CASTLE_K ? 6 : 2, rank), -1, flag);
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // Make / unmake

  /** Captured piece code of `m` in the current position (0 if none). */
  captured(m: number): number {
    if (moveFlag(m) === FLAG_EP) return this.sq[(moveFrom(m) & ~7) | (moveTo(m) & 7)];
    return this.sq[moveTo(m)];
  }

  /**
   * Plays `m`. Returns false (and leaves the position unchanged) if the move
   * would leave the mover's royal piece capturable.
   */
  make(m: number): boolean {
    const from = moveFrom(m);
    const to = moveTo(m);
    const flag = moveFlag(m);
    const promo = movePromo(m);
    const sq = this.sq;
    const side = this.side;
    const mover = sq[from];
    const moverType = codeType(mover);
    const p = this.ply++;
    this.uMove[p] = m;
    this.uMover[p] = mover;
    this.uCastling[p] = this.castling;
    this.uEp[p] = this.ep;
    this.uHalf[p] = this.halfmove;
    this.uHashLo[p] = this.hashLo;
    this.uHashHi[p] = this.hashHi;
    const slots = this.extra.length;
    for (let i = 0; i < slots; i++) this.uExtra[p * slots + i] = this.extra[i];

    // Variant state first, from the position before the move (like the engine's afterMove).
    this.hooks.afterMove?.(this, this.types[moverType].letter, side);

    let lo = this.hashLo ^ this.zCastleLo[this.castling];
    let hi = this.hashHi ^ this.zCastleHi[this.castling];
    if (this.ep >= 0) {
      lo ^= this.zEpLo[this.ep & 7];
      hi ^= this.zEpHi[this.ep & 7];
    }

    // Capture
    const victimSq = flag === FLAG_EP ? (from & ~7) | (to & 7) : to;
    const victim = sq[victimSq];
    this.uCaptured[p] = victim;
    if (victim !== 0) {
      const z = this.slot(victim) * 64 + victimSq;
      lo ^= this.zPieceLo[z];
      hi ^= this.zPieceHi[z];
      this.remove(victimSq);
    }

    // Move (and promote)
    let z = this.slot(mover) * 64 + from;
    lo ^= this.zPieceLo[z];
    hi ^= this.zPieceHi[z];
    if (promo >= 0) {
      this.remove(from);
      this.put(to, makeCode(promo, side));
      z = this.slot(sq[to]) * 64 + to;
    } else {
      this.shift(from, to);
      z = this.slot(mover) * 64 + to;
    }
    lo ^= this.zPieceLo[z];
    hi ^= this.zPieceHi[z];

    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const rank = from & ~7;
      const rf = rank | (flag === FLAG_CASTLE_K ? 7 : 0);
      const rt = rank | (flag === FLAG_CASTLE_K ? 5 : 3);
      const rook = sq[rf];
      const zr = this.slot(rook) * 64;
      lo ^= this.zPieceLo[zr + rf] ^ this.zPieceLo[zr + rt];
      hi ^= this.zPieceHi[zr + rf] ^ this.zPieceHi[zr + rt];
      this.shift(rf, rt);
    }

    // Castling rights
    let c = this.castling;
    if (this.types[moverType].castles) c &= side === 0 ? ~3 : ~12;
    if (from === 0 || to === 0) c &= ~2;
    if (from === 7 || to === 7) c &= ~1;
    if (from === 56 || to === 56) c &= ~8;
    if (from === 63 || to === 63) c &= ~4;
    this.castling = c;
    lo ^= this.zCastleLo[c];
    hi ^= this.zCastleHi[c];

    this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
    if (this.ep >= 0) {
      lo ^= this.zEpLo[this.ep & 7];
      hi ^= this.zEpHi[this.ep & 7];
    }
    this.halfmove = this.types[moverType].isPawn || victim !== 0 ? 0 : this.halfmove + 1;
    if (side === 1) this.fullmove++;
    this.side = side === 0 ? 1 : 0;
    lo ^= this.zSideLo;
    hi ^= this.zSideHi;
    this.hashLo = lo;
    this.hashHi = hi;

    if (this.inCheck(side)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake(): void {
    const p = --this.ply;
    const m = this.uMove[p];
    const from = moveFrom(m);
    const to = moveTo(m);
    const flag = moveFlag(m);
    const side: Side = this.side === 0 ? 1 : 0;
    this.side = side;
    if (side === 1) this.fullmove--;
    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const rank = from & ~7;
      this.shift(rank | (flag === FLAG_CASTLE_K ? 5 : 3), rank | (flag === FLAG_CASTLE_K ? 7 : 0));
    }
    if (movePromo(m) >= 0) {
      this.remove(to);
      this.put(from, this.uMover[p]);
    } else {
      this.shift(to, from);
    }
    const victim = this.uCaptured[p];
    if (victim !== 0) this.put(flag === FLAG_EP ? (from & ~7) | (to & 7) : to, victim);
    this.castling = this.uCastling[p];
    this.ep = this.uEp[p];
    this.halfmove = this.uHalf[p];
    this.hashLo = this.uHashLo[p];
    this.hashHi = this.uHashHi[p];
    const slots = this.extra.length;
    for (let i = 0; i < slots; i++) this.extra[i] = this.uExtra[p * slots + i];
  }

  /** The move that led to the current position (0 at the root of the stack, -1 after a null move). */
  lastMove(): number {
    return this.ply > 0 ? this.uMove[this.ply - 1] : 0;
  }

  /** Null move (pass) for null-move pruning; never call while in check. */
  makeNull(): void {
    const p = this.ply++;
    this.uMove[p] = -1;
    this.uEp[p] = this.ep;
    this.uHashLo[p] = this.hashLo;
    this.uHashHi[p] = this.hashHi;
    this.uHalf[p] = this.halfmove;
    if (this.ep >= 0) {
      this.hashLo ^= this.zEpLo[this.ep & 7];
      this.hashHi ^= this.zEpHi[this.ep & 7];
      this.ep = -1;
    }
    this.halfmove++;
    this.side = this.side === 0 ? 1 : 0;
    this.hashLo ^= this.zSideLo;
    this.hashHi ^= this.zSideHi;
  }

  unmakeNull(): void {
    const p = --this.ply;
    this.side = this.side === 0 ? 1 : 0;
    this.ep = this.uEp[p];
    this.hashLo = this.uHashLo[p];
    this.hashHi = this.uHashHi[p];
    this.halfmove = this.uHalf[p];
  }

  // -------------------------------------------------------------------------
  // Rules helpers

  /** The variant's insufficient-material rule (only 'none'-material pieces and at most one minor). */
  insufficientMaterial(): boolean {
    let relevant = 0;
    let minors = 0;
    for (const t of this.types) {
      if (t.material === 'none') continue;
      const n = this.listCount[t.index * 2] + this.listCount[t.index * 2 + 1];
      relevant += n;
      if (t.material === 'minor') minors += n;
      if (relevant > 1) return false;
    }
    return relevant === 0 || minors === 1;
  }

  /** All legal moves (slow path: for roots and tests). */
  legalMoves(): number[] {
    const buf = new Int32Array(512);
    const n = this.generate(buf, 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.make(buf[i])) {
        this.unmake();
        out.push(buf[i]);
      }
    }
    return out;
  }

  perft(depth: number, buf: Int32Array = new Int32Array(256 * 64), start = 0): number {
    const n = this.generate(buf, start);
    let total = 0;
    for (let i = start; i < n; i++) {
      if (!this.make(buf[i])) continue;
      total += depth <= 1 ? 1 : this.perft(depth - 1, buf, n);
      this.unmake();
    }
    return total;
  }
}

/** Inverse of stepTable for tables built by it (finds the direction from any interior square). */
function dirOf(table: Int8Array): Dir {
  for (const [key, t] of stepCache) {
    if (t === table) return [Math.floor(key / 64) - 16, (key % 64) - 16];
  }
  throw new Error('dirOf: unknown table');
}
