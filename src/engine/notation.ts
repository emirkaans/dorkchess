import { FILES, emptyBoard, fileOf, makeSquare, parseSquare, rankOf, squareName } from './board.ts';
import { applyMove, pieceDef } from './movegen.ts';
import { isInCheck, legalMoves } from './legality.ts';
import type { Move, Piece, Position, VariantDefinition } from './types.ts';

// ---------------------------------------------------------------------------
// FEN-like position text:
//   <placement> <turn> <castling> <ep> <halfmove> <fullmove> [<variant extra>]
// Piece letters come from the variant's piece definitions.

function charToPiece(v: VariantDefinition, ch: string): Piece {
  const lower = ch.toLowerCase();
  const def = Object.values(v.pieces).find((d) => d.fenChar === lower);
  if (!def) throw new Error(`Unknown piece letter '${ch}' for variant ${v.id}`);
  return { type: def.type, color: ch === lower ? 'b' : 'w' };
}

function pieceToChar(v: VariantDefinition, p: Piece): string {
  const ch = pieceDef(v, p.type).fenChar;
  return p.color === 'w' ? ch.toUpperCase() : ch;
}

export function parseFen(v: VariantDefinition, fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1', extra] = parts;
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error(`Invalid FEN placement: ${placement}`);
  const board = emptyBoard();
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else {
        if (file > 7) throw new Error(`Invalid FEN row: ${row}`);
        board[makeSquare(file, rank)] = charToPiece(v, ch);
        file++;
      }
    }
    if (file !== 8) throw new Error(`Invalid FEN row: ${row}`);
  });
  if (turn !== 'w' && turn !== 'b') throw new Error(`Invalid turn: ${turn}`);
  return {
    board,
    turn,
    castling: {
      wK: castling.includes('K'),
      wQ: castling.includes('Q'),
      bK: castling.includes('k'),
      bQ: castling.includes('q'),
    },
    ep: ep === '-' ? null : parseSquare(ep),
    halfmove: Number(half),
    fullmove: Number(full),
    extra: v.parseExtra ? v.parseExtra(extra) : v.initialExtra(),
  };
}

export function toFen(v: VariantDefinition, pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[makeSquare(file, rank)];
      if (!p) empty++;
      else {
        if (empty) row += String(empty);
        empty = 0;
        row += pieceToChar(v, p);
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  const c = pos.castling;
  const castling = (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '') || '-';
  const fields = [
    rows.join('/'),
    pos.turn,
    castling,
    pos.ep === null ? '-' : squareName(pos.ep),
    String(pos.halfmove),
    String(pos.fullmove),
  ];
  const extra = v.serializeExtra?.(pos.extra);
  if (extra) fields.push(extra);
  return fields.join(' ');
}

// ---------------------------------------------------------------------------
// Short algebraic notation

export function moveToSan(v: VariantDefinition, pos: Position, move: Move, legal: Move[] = legalMoves(v, pos)): string {
  let san: string;
  if (move.castle) {
    san = move.castle === 'K' ? 'O-O' : 'O-O-O';
  } else {
    const letter = pieceDef(v, move.piece).sanLetter;
    const capture = move.captured !== undefined;
    if (letter === '') {
      san = (capture ? FILES[fileOf(move.from)] + 'x' : '') + squareName(move.to);
    } else {
      const rivals = legal.filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from && !m.castle,
      );
      let dis = '';
      if (rivals.length) {
        if (!rivals.some((m) => fileOf(m.from) === fileOf(move.from))) dis = FILES[fileOf(move.from)];
        else if (!rivals.some((m) => rankOf(m.from) === rankOf(move.from))) dis = String(rankOf(move.from) + 1);
        else dis = squareName(move.from);
      }
      san = letter + dis + (capture ? 'x' : '') + squareName(move.to);
    }
    if (move.promotion) san += '=' + pieceDef(v, move.promotion).sanLetter;
  }
  const next = applyMove(v, pos, move);
  if (isInCheck(v, next)) san += legalMoves(v, next).length === 0 ? '#' : '+';
  return san;
}
