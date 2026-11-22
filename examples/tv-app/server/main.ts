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
import { missingBuild, startStaticServer } from './static.ts';

const API_PORT = Number(process.env.API_PORT ?? 8091);
const WEB_PORT = Number(process.env.WEB_PORT ?? 8090);
const mode = process.argv[2] ?? 'api';

if (mode !== 'api' && mode !== 'web') {
  console.error(`Unknown mode "${mode}". Use "api" or "web".`);
  process.exit(1);
}

// The web server listens first: the API answering means both are up (the e2e config waits on it).
if (mode === 'web') {
  const root = fileURLToPath(new URL('../dist/web', import.meta.url));
  await startStaticServer(root, WEB_PORT);
  console.log(`[web] http://localhost:${WEB_PORT}`);
  const missing = await missingBuild(root);
  if (missing) console.warn(`[web] ${missing} Native targets only need the API.`);
}

await startApiServer(API_PORT);
console.log(`[api] http://localhost:${API_PORT}/api/catalog`);
