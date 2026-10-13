import type { ReactNode } from 'react';
import { pathOf } from './routes.ts';

/**
 * A link to a player's profile. A plain click moves within the app (the app
 * follows the address on popstate); `newTab` opens it beside a running game.
 */
export function ProfileLink({
  username,
  newTab = false,
  children,
}: {
  username: string;
  newTab?: boolean;
  children: ReactNode;
}) {
  const href = pathOf({ kind: 'profile', username });
  if (newTab) {
    return (
      <a className="profile-link" href={href} target="_blank" rel="noopener">
        {children}
      </a>
    );
  }
  return (
    <a
      className="profile-link"
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        history.pushState(null, '', href);
        dispatchEvent(new PopStateEvent('popstate'));
      }}
    >
      {children}
    </a>
  );
}
