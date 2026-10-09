// Small wrappers around localStorage. Storage can be missing or throw
// (private mode, blocked site data), so every access is guarded and callers
// always get a usable fallback.

const PREFIX = 'dorkchess:';

/** localStorage when the environment has one (typed locally: this folder is checked without the DOM lib). */
const store = () =>
  (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } })
    .localStorage;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = store()?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    store()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not persisted; the app keeps working with in-memory state.
  }
}
