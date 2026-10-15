// The daily puzzle results kept in this browser (a guest's only record; a
// signed-in player's are on the server too). Shared by the daily page and the
// home page's daily box.

import { gridSolved, streakOf } from '../online/daily.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';

/** This browser's daily results: day → grid. Signed-in players' are also on the server. */
const RESULTS_KEY = 'daily:results';

export const dailyResults = (): Record<string, string> => loadJSON<Record<string, string>>(RESULTS_KEY, {});

/** This browser's streak (a guest's only one). */
export const localStreak = (today: string): number =>
  streakOf(
    Object.entries(dailyResults())
      .filter(([, grid]) => gridSolved(grid))
      .map(([day]) => day),
    today,
  );

export function saveLocal(day: string, grid: string) {
  const all = dailyResults();
  if (all[day]) return;
  saveJSON(RESULTS_KEY, { ...all, [day]: grid });
}
