// Addresses of the site's pages, as on lichess:
//   /                 home
//   /analysis         analysis board (board editor)
//   /online           create an online game
//   /<gameId>         a game (being played, or finished)
//   /<gameId>/analysis   analysis of that game
// Pure: no React, no DOM.

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'analysis' }
  | { readonly kind: 'online' }
  | { readonly kind: 'game'; readonly id: string }
  | { readonly kind: 'review'; readonly id: string };

/** Paths that are pages, not game ids. */
const RESERVED = new Set(['analysis', 'online', 'assets', 'icons', 'api']);
/** Game ids: 8 letters / digits; older history records also have dashes. */
const GAME = /^\/([A-Za-z0-9][A-Za-z0-9-]{3,39})(\/analysis)?$/;

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { kind: 'home' };
  if (p === '/analysis') return { kind: 'analysis' };
  if (p === '/online') return { kind: 'online' };
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
    case 'game':
      return `/${r.id}`;
    case 'review':
      return `/${r.id}/analysis`;
  }
}

/** Full link to a game (or its analysis) for sharing. */
export const gameUrl = (id: string, analysis = false) =>
  `${location.origin}${pathOf(analysis ? { kind: 'review', id } : { kind: 'game', id })}`;
