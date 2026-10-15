// POST /api/errors: an error report from a browser (src/ui/errorReport.ts),
// written to the Worker's logs. Nothing is stored. The request limits
// (server/limits.ts) keep one visitor from flooding the logs.

import { cleanReport } from '../src/online/errors.ts';

export async function handleErrors(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/errors') return null;
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const report = cleanReport(await request.json().catch(() => null));
  if (report) console.error('client error', JSON.stringify(report));
  return new Response(null, { status: 204 });
}
