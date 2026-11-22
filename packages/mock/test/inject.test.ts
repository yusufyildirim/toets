import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createMockServer,
  failure,
  http,
  HttpResponse,
  latency,
  MockErrorCode,
  type MockServer,
} from '../src/index.js';
import { startUpstream, until, viaMock, type Upstream } from './helpers.js';

let server: MockServer;
let upstream: Upstream;

beforeAll(async () => {
  server = await createMockServer({
    handlers: [http.get('*/v1/rails', () => HttpResponse.json(['rail']))],
  });
  upstream = await startUpstream();
});
afterEach(() => {
  server.resetHandlers();
  server.clearRequests();
  upstream.received.length = 0;
});
afterAll(async () => {
  await server.close();
  await upstream.close();
});

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

describe('latency()', () => {
  it('delays mocked responses without changing them', async () => {
    server.use(latency(120, { url: '/v1/rails' }));
    let body: unknown;
    const ms = await timed(async () => {
      body = await (await viaMock(server.url, '/v1/rails')).json();
    });
    expect(body).toEqual(['rail']);
    expect(ms).toBeGreaterThanOrEqual(110);
  });

  it('delays proxied requests and only matching ones', async () => {
    server.use(latency({ min: 100, max: 120 }, { method: 'post' }));
    const slow = await timed(() =>
      viaMock(server.url, '/echo', { origin: upstream.origin, method: 'POST', body: 'x' }),
    );
    const fast = await timed(() => viaMock(server.url, '/echo', { origin: upstream.origin }));
    expect(slow).toBeGreaterThanOrEqual(95);
    expect(fast).toBeLessThan(90);
    expect(server.requests().map((r) => r.mocked)).toEqual([false, false]);
  });

  it("'infinite' never answers; the app's abort is recorded", async () => {
    server.use(latency('infinite', { url: '/v1/rails' }));
    const controller = new AbortController();
    const pending = viaMock(server.url, '/v1/rails', { signal: controller.signal });
    await until(() => server.requests().length === 1);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await until(() => server.requests()[0]?.error !== null);
    expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.CLIENT_ABORTED);
  });

  it('validates its arguments', () => {
    expect(() => latency(-1)).toThrow(expect.objectContaining({ code: 'MOCK_INVALID_OPTION' }));
    expect(() => latency(Number.NaN)).toThrow(/Invalid latency/);
    expect(() => latency({ min: 10, max: 5 })).toThrow(/min <= max/);
  });
});

describe('failure()', () => {
  it('answers with an error status for the first n requests, then lets them through', async () => {
    server.use(failure({ url: '/v1/rails', status: 503, times: 2 }));
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await viaMock(server.url, '/v1/rails')).status);
    expect(statuses).toEqual([503, 503, 200]);
    expect(server.requests().map((r) => r.mocked)).toEqual([true, true, true]);
  });

  it('drops the connection when no status is given', async () => {
    server.use(failure({ url: '/v1/rails' }));
    await expect(viaMock(server.url, '/v1/rails')).rejects.toThrow();
    await expect(viaMock(server.url, '/v1/rails')).rejects.toThrow();
    expect(server.requests().map((r) => r.error?.code)).toEqual([
      MockErrorCode.NETWORK_ERROR,
      MockErrorCode.NETWORK_ERROR,
    ]);
  });

  it('can fail proxied traffic', async () => {
    server.use(failure({ url: `${upstream.origin}/*`, status: 500, method: 'GET' }));
    expect((await viaMock(server.url, '/a', { origin: upstream.origin })).status).toBe(500);
    expect(upstream.received).toHaveLength(0);
  });

  it('validates its arguments', () => {
    expect(() => failure({ status: 200 })).toThrow(/between 400 and 599/);
    expect(() => failure({ times: 0 })).toThrow(/positive integer/);
  });
});
