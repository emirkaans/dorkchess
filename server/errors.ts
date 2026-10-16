// POST /api/errors: an error report from a browser (src/ui/errorReport.ts),
// written to the Worker's logs and kept two weeks for the admin page
// (server/admin.ts). The request limits (server/limits.ts) keep one visitor
// from flooding them.

import { cleanReport } from '../src/online/errors.ts';
import { keepErrorReport } from './admin.ts';

export async function handleErrors(request: Request, url: URL, db?: D1Database): Promise<Response | null> {
  if (url.pathname !== '/api/errors') return null;
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const report = cleanReport(await request.json().catch(() => null));
  if (report) {
    console.error('client error', JSON.stringify(report));
    await keepErrorReport(db, report).catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
