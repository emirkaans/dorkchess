// Addresses of the site's pages, as on lichess:
//   /                 home
//   /analysis         analysis board (board editor)
//   /online           create an online game
//   /signup           pick a username after the first sign-in
//   /@/<username>     a player's profile
//   /puzzles          puzzles (/puzzles/<id>: one puzzle)
//   /daily            the daily puzzle
//   /rush             Puzzle Rush
//   /leaderboard      the best players
//   /<gameId>         a game (being played, or finished)
//   /<gameId>/analysis   analysis of that game
// Pure: no React, no DOM.

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'analysis' }
  | { readonly kind: 'online' }
  | { readonly kind: 'signup' }
  | { readonly kind: 'profile'; readonly username: string }
  | { readonly kind: 'puzzles'; readonly id: string | null }
  | { readonly kind: 'daily' }
  | { readonly kind: 'rush' }
  | { readonly kind: 'leaderboard' }
  | { readonly kind: 'game'; readonly id: string }
  | { readonly kind: 'review'; readonly id: string };

/** Paths that are pages, not game ids. */
const RESERVED = new Set([
  'analysis',
  'online',
  'signup',
  'auth',
  'puzzles',
  'daily',
  'rush',
  'leaderboard',
  'assets',
  'icons',
  'api',
]);
/** Game ids: 8 letters / digits; older history records also have dashes. */
const GAME = /^\/([A-Za-z0-9][A-Za-z0-9-]{3,39})(\/analysis)?$/;

export function parseRoute(pathname: string): Route {
  // Browsers may send '@' as '%40' (and other characters escaped).
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // a malformed escape: match the path as it is
  }
  const p = decoded.replace(/\/+$/, '') || '/';
  if (p === '/') return { kind: 'home' };
  if (p === '/analysis') return { kind: 'analysis' };
  if (p === '/online') return { kind: 'online' };
  if (p === '/signup') return { kind: 'signup' };
  if (p === '/puzzles') return { kind: 'puzzles', id: null };
  if (p === '/daily') return { kind: 'daily' };
  if (p === '/rush') return { kind: 'rush' };
  if (p === '/leaderboard') return { kind: 'leaderboard' };
  const puzzle = /^\/puzzles\/([A-Za-z0-9]{3,16})$/.exec(p);
  if (puzzle) return { kind: 'puzzles', id: puzzle[1] };
  const profile = /^\/@\/([A-Za-z][A-Za-z0-9_-]{2,19})$/.exec(p);
  if (profile) return { kind: 'profile', username: profile[1] };
  const m = GAME.exec(p);
  if (m && !RESERVED.has(m[1])) return m[2] ? { kind: 'review', id: m[1] } : { kind: 'game', id: m[1] };
  return { kind: 'home' };
}

export function pathOf(r: Route): string {
  switch (r.kind) {
    case 'home':
      return '/';
    case 'analysis':
      return '/analysis';
    case 'online':
      return '/online';
    case 'signup':
      return '/signup';
    case 'profile':
      return `/@/${r.username}`;
    case 'puzzles':
      return r.id ? `/puzzles/${r.id}` : '/puzzles';
    case 'daily':
      return '/daily';
    case 'rush':
      return '/rush';
    case 'leaderboard':
      return '/leaderboard';
    case 'game':
      return `/${r.id}`;
    case 'review':
      return `/${r.id}/analysis`;
  }
}

/** Full link to a game (or its analysis) for sharing. */
export const gameUrl = (id: string, analysis = false) =>
  `${location.origin}${pathOf(analysis ? { kind: 'review', id } : { kind: 'game', id })}`;
