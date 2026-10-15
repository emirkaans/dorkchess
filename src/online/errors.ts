// Errors in the browser, reported to the server (server/errors.ts), which
// writes them to the Worker's logs (Cloudflare dashboard → Workers → punkchess
// → Logs). No personal data: the message, a short stack, the page's path
// (no query or hash) and the browser. Pure.

export interface ErrorReport {
  readonly message: string;
  readonly stack: string;
  /** Path of the page, without the query or hash. */
  readonly path: string;
  readonly userAgent: string;
  /** The build that ran (its bundle file name), to tell old versions apart. */
  readonly build: string;
}

export const MAX_MESSAGE = 300;
export const MAX_STACK = 2000;
/** A page sends at most this many reports (a loop of errors is not a flood of reports). */
export const MAX_REPORTS_PER_PAGE = 5;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A report from untrusted input, cut to size, or null when it is not one. */
export function cleanReport(body: unknown): ErrorReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const message = text(b.message, MAX_MESSAGE);
  if (!message) return null;
  return {
    message,
    stack: text(b.stack, MAX_STACK),
    path: text(b.path, 200).split(/[?#]/)[0],
    userAgent: text(b.userAgent, 300),
    build: text(b.build, 80),
  };
}
