// Public engine API.
export * from './types.ts';
export * from './board.ts';
export { applyMove, isSquareAttacked, pieceDef, pseudoMoves, pseudoMovesFrom } from './movegen.ts';
export { isInCheck, isLegal, legalMoves, legalMovesFrom, perft, royalSquares } from './legality.ts';
export {
  createGame,
  findMove,
  isInsufficientMaterial,
  makeMove,
  playSan,
  positionKey,
  setupStartPosition,
  undoMove,
} from './game.ts';
export { moveToSan, parseFen, toFen } from './notation.ts';
export { getVariant, listVariants, registerVariant } from './variants/index.ts';
