// Headers the Worker adds to requests of a signed-in player (from the session
// cookie) before passing them to the lobby or a game room. Anything a browser
// sends under these names is removed first, so they can be trusted.

import type { AccountUser } from '../src/online/account.ts';

export const ACCOUNT_ID = 'x-punkchess-account';
export const ACCOUNT_NAME = 'x-punkchess-username';
export const ACCOUNT_RATING = 'x-punkchess-rating';

/** A copy of `request` that carries `user` (or no account) in the account headers. */
export function withAccountHeaders(request: Request, user: AccountUser | null): Request {
  const headers = new Headers(request.headers);
  headers.delete(ACCOUNT_ID);
  headers.delete(ACCOUNT_NAME);
  headers.delete(ACCOUNT_RATING);
  if (user) {
    headers.set(ACCOUNT_ID, user.id);
    headers.set(ACCOUNT_NAME, user.username);
    if (user.rating !== null) headers.set(ACCOUNT_RATING, String(user.rating));
  }
  return new Request(request, { headers });
}
