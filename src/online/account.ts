// Accounts, shared by the browser and the Worker: the username rules and the
// shapes of the account API. Pure: no React, no DOM, no storage.

/** A signed-in player. */
export interface AccountUser {
  readonly id: string;
  readonly username: string;
  readonly rating: number | null;
}

/** GET /api/me: who this browser is. */
export interface MeResponse {
  readonly user: AccountUser | null;
  /** Signed in with Google but no account yet: a username to suggest. */
  readonly signup: { readonly suggested: string } | null;
  /** Ways to sign in that are set up on this server (none: the sign-in button is hidden). */
  readonly providers: readonly 'google'[];
}

export type UsernameProblem = 'length' | 'chars' | 'start' | 'reserved' | 'taken';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Names nobody may take (pages of the site, words that would mislead). */
const RESERVED = new Set([
  'admin',
  'administrator',
  'analysis',
  'anonymous',
  'anon',
  'api',
  'auth',
  'bot',
  'computer',
  'guest',
  'help',
  'lichess',
  'login',
  'logout',
  'mod',
  'moderator',
  'null',
  'online',
  'punkchess',
  'root',
  'signup',
  'support',
  'system',
]);

/**
 * What is wrong with a username, or null when it can be taken (apart from
 * being free, which only the server knows): 3 to 20 letters, digits, '_' or
 * '-', starting with a letter.
 */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return 'length';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'chars';
  if (!/^[A-Za-z]/.test(name)) return 'start';
  if (RESERVED.has(name.toLowerCase())) return 'reserved';
  return null;
}

/** A username to suggest from a display name: allowed characters only, cut to length. */
export function suggestUsername(display: string | null | undefined): string {
  const ascii = (display ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .replace(/^[^A-Za-z]+/, '')
    .slice(0, USERNAME_MAX);
  return usernameProblem(ascii) ? '' : ascii;
}
