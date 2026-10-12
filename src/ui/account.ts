// Browser side of accounts: who is signed in (shared by every component), and
// the calls to sign in, pick a username and sign out.

import { useEffect, useSyncExternalStore } from 'react';
import type { AccountUser, MeResponse, UsernameProblem } from '../online/account.ts';

interface AccountState {
  /** Still asking the server. */
  readonly loading: boolean;
  readonly user: AccountUser | null;
  /** Signed in with Google, no account yet: the suggested username. */
  readonly signup: { readonly suggested: string } | null;
  /** Signing in is set up on the server. */
  readonly canSignIn: boolean;
}

let state: AccountState = { loading: true, user: null, signup: null, canSignIn: false };
const listeners = new Set<() => void>();
const set = (next: AccountState) => {
  state = next;
  for (const l of listeners) l();
};

let asked = false;
/** Asks the server who this browser is (again). */
export async function refreshAccount(): Promise<void> {
  asked = true;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    const me = res.ok ? ((await res.json()) as MeResponse) : null;
    set({
      loading: false,
      user: me?.user ?? null,
      signup: me?.signup ?? null,
      canSignIn: !!me?.providers?.includes('google'),
    });
  } catch {
    set({ loading: false, user: null, signup: null, canSignIn: false });
  }
}

/** The account state; the first user of the hook asks the server. */
export function useAccount(): AccountState {
  useEffect(() => {
    if (!asked) void refreshAccount();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Goes to Google's sign-in page; afterwards the player comes back to `returnTo`. */
export function signInWithGoogle(returnTo = location.pathname): void {
  location.assign(`/auth/google/start?return=${encodeURIComponent(returnTo)}`);
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    set({ ...state, loading: false, user: null, signup: null });
  }
}

/** Deletes the signed-in account; true when done. */
export async function deleteAccount(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/delete', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return false;
    set({ ...state, loading: false, user: null, signup: null });
    return true;
  } catch {
    return false;
  }
}

/** Is a username allowed and free? (null: yes) */
export async function checkUsername(name: string): Promise<UsernameProblem | null> {
  const res = await fetch(`/api/auth/username?name=${encodeURIComponent(name)}`);
  const data = (await res.json().catch(() => ({}))) as { problem?: UsernameProblem };
  return data.problem ?? null;
}

/** Creates the account after a first sign-in; returns the problem when the name cannot be taken. */
export async function chooseUsername(username: string): Promise<UsernameProblem | 'network' | null> {
  try {
    const res = await fetch('/api/auth/username', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = (await res.json().catch(() => ({}))) as { user?: AccountUser; problem?: UsernameProblem };
    if (data.user) {
      set({ ...state, loading: false, user: data.user, signup: null });
      return null;
    }
    return data.problem ?? 'network';
  } catch {
    return 'network';
  }
}
