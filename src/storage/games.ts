// Finished-game records: browser storage (at most MAX_GAMES, oldest dropped)
// and a PGN-like text format for export/import. No React / DOM imports.

import { createGame, getVariant, listVariants, playSan, toFen } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import { loadJSON, saveJSON } from './local.ts';

export const MAX_GAMES = 200;
const KEY = 'games';

export type ResultCode = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface SavedGame {
  readonly id: string;
  /** ISO timestamp of the end of the game. */
  readonly date: string;
  readonly variantId: string;
  /** Turkish mode label, e.g. "Bilgisayara karşı". */
  readonly mode: string;
  /** Player descriptions, e.g. "İnsan", "Usta (4)". */
  readonly white: string;
  readonly black: string;
  readonly result: ResultCode;
  /** Turkish end reason, e.g. "Mat". */
  readonly termination: string;
  readonly startFen: string;
  readonly moves: readonly string[];
}

export function loadGames(): SavedGame[] {
  const games = loadJSON<SavedGame[]>(KEY, []);
  return Array.isArray(games) ? games : [];
}

/** Adds a game at the front; keeps at most MAX_GAMES (oldest dropped). Returns the new list. */
export function storeGame(game: SavedGame, existing: readonly SavedGame[] = loadGames()): SavedGame[] {
  const games = [game, ...existing.filter((g) => g.id !== game.id)].slice(0, MAX_GAMES);
  saveJSON(KEY, games);
  return games;
}

export function newGameId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// PGN-like text

const pgnDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

/** Writes headers ([Variant "jester"] etc.), then numbered SAN moves and the result. */
export function exportPgn(g: SavedGame): string {
  const tags: [string, string][] = [
    ['Event', 'dorkchess'],
    ['Variant', g.variantId],
    ['Date', pgnDate(g.date)],
    ['Mode', g.mode],
    ['White', g.white],
    ['Black', g.black],
    ['Result', g.result],
    ['Termination', g.termination],
    ['FEN', g.startFen],
  ];
  const v = getVariant(g.variantId);
  const first = createGame(v, g.startFen).position;
  let n = first.fullmove;
  let white = first.turn === 'w';
  const parts: string[] = [];
  g.moves.forEach((san, i) => {
    if (white) parts.push(`${n}.`);
    else if (i === 0) parts.push(`${n}...`);
    parts.push(san);
    if (!white) n++;
    white = !white;
  });
  parts.push(g.result);
  const header = tags.map(([k, val]) => `[${k} "${val.replace(/"/g, "'")}"]`).join('\n');
  return `${header}\n\n${wrap(parts.join(' '), 80)}\n`;
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export interface ImportedGame {
  readonly game: SavedGame;
  /** Every position of the game, replayed by the engine. */
  readonly states: readonly GameState[];
}

/**
 * Parses the PGN-like text and replays it with the engine (every move must be
 * legal). Throws an Error with a Turkish message on bad input.
 */
export function importPgn(text: string): ImportedGame {
  const tags: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm)) tags[m[1]] = m[2];
  const variantId = tags.Variant ?? 'standard';
  if (!listVariants().some((v) => v.id === variantId)) throw new Error(`Bilinmeyen varyant: ${variantId}`);
  const v = getVariant(variantId);

  const body = text
    .replace(/^\s*\[.*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, ' ')
    .trim();
  const tokens = body.split(/\s+/).filter(Boolean);
  const results = new Set(['1-0', '0-1', '1/2-1/2', '*']);
  const sans = tokens.filter((t) => !results.has(t) && !/^\d+\.+$/.test(t)).map((t) => t.replace(/^\d+\.+/, ''));

  let state: GameState;
  try {
    state = createGame(v, tags.FEN ?? v.startPosition);
  } catch {
    throw new Error('Başlangıç konumu (FEN) okunamadı.');
  }
  const states = [state];
  for (const san of sans) {
    try {
      state = playSan(v, state, san);
    } catch {
      throw new Error(`Geçersiz hamle: ${san} (${states.length}. konumda)`);
    }
    states.push(state);
  }

  const tagResult = tags.Result as ResultCode | undefined;
  const result: ResultCode = tagResult && results.has(tagResult) ? tagResult : resultCode(state);
  return {
    states,
    game: {
      id: newGameId(),
      date: tags.Date ? new Date(tags.Date.replace(/\./g, '-')).toISOString() : new Date().toISOString(),
      variantId,
      mode: tags.Mode ?? 'İçe aktarıldı',
      white: tags.White ?? '?',
      black: tags.Black ?? '?',
      result,
      termination: tags.Termination ?? '',
      startFen: toFen(v, states[0].position),
      moves: state.moves.map((m) => m.san),
    },
  };
}

function resultCode(state: GameState): ResultCode {
  if (!state.result) return '*';
  if (state.result.winner === 'w') return '1-0';
  if (state.result.winner === 'b') return '0-1';
  return '1/2-1/2';
}

/** Replays a saved game into its positions (for the replay viewer). */
export function replay(g: SavedGame): GameState[] {
  const v = getVariant(g.variantId);
  let state = createGame(v, g.startFen);
  const states = [state];
  for (const san of g.moves) {
    state = playSan(v, state, san);
    states.push(state);
  }
  return states;
}
