/**
 * Exercises the app-side routing snippet from docs/app-integration.md against a real server,
 * so the documented integration can not silently break.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMockServer, http, HttpResponse, type MockServer } from '../src/index.js';
import { startUpstream, type Upstream } from './helpers.js';

// --- copied from docs/app-integration.md ---
const MOCK_HEADER = 'x-dpad-original-origin';

function routeRequest(url: string, mockUrl: string | undefined) {
  if (!mockUrl) return { url, headers: {} };
  const real = new URL(url);
  return {
    url: mockUrl + real.pathname + real.search,
    headers: { [MOCK_HEADER]: real.origin },
  };
}

function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const routed = routeRequest(url, getMockUrl());
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(routed.headers)) headers.set(name, value);
  return fetch(routed.url, { ...init, headers });
}
// --- end of snippet ---

let mockUrl: string | undefined;
const getMockUrl = () => mockUrl;

let server: MockServer;
let upstream: Upstream;

beforeAll(async () => {
  server = await createMockServer();
  upstream = await startUpstream();
});
afterAll(async () => {
  await server.close();
  await upstream.close();
});

it('routes API calls through the mock server only when mockUrl is set', async () => {
  const api = `${upstream.origin}/v2`;
  server.use(http.get('/v2/rails', () => HttpResponse.json([{ id: 'mocked' }])));

  mockUrl = undefined;
  const direct = (await (await apiFetch(`${api}/rails?page=2`)).json()) as { url: string };
  expect(direct.url).toBe('/v2/rails?page=2');
  expect(server.requests()).toHaveLength(0);

  mockUrl = server.url;
  expect(await (await apiFetch(`${api}/rails?page=2`)).json()).toEqual([{ id: 'mocked' }]);
  const proxied = (await (await apiFetch(`${api}/other`)).json()) as { url: string };
  expect(proxied.url).toBe('/v2/other');

  expect(server.requests().map((r) => [r.url, r.mocked])).toEqual([
    [`${api}/rails?page=2`, true],
    [`${api}/other`, false],
  ]);
});
