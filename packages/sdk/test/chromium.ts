import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { rolldown } from 'rolldown';

/** Bundles a fixture app (TypeScript, workspace sources) into one browser script. */
export async function bundleFixture(relative: string): Promise<string> {
  const bundle = await rolldown({
    input: fileURLToPath(new URL(relative, import.meta.url)),
    platform: 'browser',
    resolve: { conditionNames: ['@toets/source', 'import', 'default'] },
    transform: { target: 'es2015' },
    logLevel: 'silent',
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  return (output[0] as { code: string }).code;
}

/** Serves `index.html` + `app.js` on 127.0.0.1. */
export async function serveApp(
  script: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(script);
      return;
    }
    if (path === '/api') {
      setTimeout(() => res.end('{}'), 300);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/**
 * Whether the Playwright Chromium build is installed (`pnpm exec playwright-core install
 * chromium`). Browser tests skip without it unless `TOETS_REQUIRE_BROWSER=1`.
 */
export function chromiumAvailable(): boolean {
  if (process.env.TOETS_REQUIRE_BROWSER === '1') return true;
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export async function launchChromium(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
