import { listVariants } from '../engine/index.ts';
import { loadJSON, saveJSON } from '../storage/local.ts';

export type Mode = 'hotseat' | 'bot' | 'botvbot';

export interface GameSettings {
  readonly mode: Mode;
  readonly variantId: string;
  /** Bilgisayara karşı */
  readonly botLevel: number;
  readonly humanColor: 'w' | 'b' | 'random';
  /** Bot vs Bot */
  readonly whiteLevel: number;
  readonly blackLevel: number;
  readonly delayMs: number;
  /** Time control id (see src/clock/clock.ts). */
  readonly timeControl: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'hotseat',
  variantId: listVariants()[0].id,
  botLevel: 2,
  humanColor: 'w',
  whiteLevel: 3,
  blackLevel: 3,
  delayMs: 1000,
  timeControl: 'none',
};

export const MODE_NAMES: Record<Mode, string> = {
  hotseat: 'İki kişi (aynı ekran)',
  bot: 'Bilgisayara karşı',
  botvbot: 'Bot vs Bot (izle)',
};

export const BOT_DELAYS = [200, 1000, 2000] as const;

const KEY = 'settings';

/** Last used settings (merged over the defaults so new fields get a value). */
export function loadSettings(): GameSettings {
  const s = { ...DEFAULT_SETTINGS, ...loadJSON<Partial<GameSettings>>(KEY, {}) };
  // A stored variant that no longer exists falls back to the default.
  return listVariants().some((v) => v.id === s.variantId) ? s : { ...s, variantId: DEFAULT_SETTINGS.variantId };
}
export const saveSettings = (s: GameSettings) => saveJSON(KEY, s);

// "Don't show the rule card again" per variant.
const hiddenKey = (variantId: string) => `hideRules:${variantId}`;
export const isRuleCardHidden = (variantId: string): boolean => loadJSON<boolean>(hiddenKey(variantId), false);
export const setRuleCardHidden = (variantId: string, hidden: boolean) => saveJSON(hiddenKey(variantId), hidden);
