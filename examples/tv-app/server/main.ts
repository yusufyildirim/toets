/**
 * Dev servers of the example app.
 *
 *   node server/main.ts api   JSON API only (for native builds and `expo start`)
 *   node server/main.ts web   JSON API + the static web build
 *
 * Ports: API_PORT (default 8091), WEB_PORT (default 8090).
 */
import { fileURLToPath } from 'node:url';

import { startApiServer } from './api.ts';
import { startStaticServer } from './static.ts';

const API_PORT = Number(process.env.API_PORT ?? 8091);
const WEB_PORT = Number(process.env.WEB_PORT ?? 8090);
const mode = process.argv[2] ?? 'api';

if (mode !== 'api' && mode !== 'web') {
  console.error(`Unknown mode "${mode}". Use "api" or "web".`);
  process.exit(1);
}

await startApiServer(API_PORT);
console.log(`[api] http://localhost:${API_PORT}/api/catalog`);

if (mode === 'web') {
  const root = fileURLToPath(new URL('../dist/web', import.meta.url));
  await startStaticServer(root, WEB_PORT);
  console.log(`[web] http://localhost:${WEB_PORT}`);
}
