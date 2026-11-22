import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { CATALOG, ITEMS } from './catalog.ts';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-dpad-original-origin',
  'access-control-max-age': '600',
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** Request handler of the example JSON API. */
export function handleApiRequest(req: IncomingMessage, res: ServerResponse): void {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/catalog') {
    sendJson(res, 200, CATALOG);
    return;
  }
  const item = /^\/api\/items\/([\w-]+)$/.exec(pathname);
  if (item) {
    const details = ITEMS.get(item[1]!);
    if (details) sendJson(res, 200, details);
    else sendJson(res, 404, { error: 'not_found' });
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

/** Starts the API on `port` (all interfaces) and resolves once it listens. */
export function startApiServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    res.on('finish', () => console.log(`[api] ${req.method} ${req.url} ${res.statusCode}`));
    handleApiRequest(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
