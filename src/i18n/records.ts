// Display texts for stored game records. Records hold codes ('bot', 'bot:4',
// 'checkmate'); older ones hold Turkish text, shown as it is.

import type { SavedGame } from '../storage/games.ts';
import { translateOr } from './index.ts';
import type { Translate } from './index.ts';

export function playerText(code: string, t: Translate): string {
  if (code === 'human') return t('human');
  const bot = /^bot:(\d+)$/.exec(code);
  return bot ? t('botLabel', { name: translateOr(t, `level.${bot[1]}`, bot[1]), level: bot[1] }) : code;
}

/** Mode, players and end reason of a record in `t`'s language. */
export function recordTexts(g: SavedGame, t: Translate) {
  return {
    mode: g.mode === 'imported' ? t('history.imported') : translateOr(t, `mode.${g.mode}`, g.mode),
    white: playerText(g.white, t),
    black: playerText(g.black, t),
    termination: g.termination ? translateOr(t, `termination.${g.termination}`, g.termination) : '',
  };
}
