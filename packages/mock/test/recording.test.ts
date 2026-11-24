import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer, delay, http, HttpResponse, type MockServer } from '../src/index.js';
import { startUpstream, until, viaMock, type Upstream } from './helpers.js';

const API = 'https://api.example.test';

let server: MockServer;
let upstream: Upstream;

beforeAll(async () => {
  server = await createMockServer({ maxRecordedBodyBytes: 64 });
  upstream = await startUpstream();
});
afterEach(() => {
  server.resetHandlers();
  server.clearRequests();
});
afterAll(async () => {
  await server.close();
  await upstream.close();
});

describe('requests()', () => {
  it('filters by method and by MSW path patterns or RegExp', async () => {
    server.use(http.all('*', () => HttpResponse.text('ok')));
    await viaMock(server.url, '/v1/items/1?lang=en', { origin: API });
    await viaMock(server.url, '/v1/items/2', { origin: API, method: 'DELETE' });
    await viaMock(server.url, '/v1/rails', { origin: 'https://other.test' });

    expect(server.requests()).toHaveLength(3);
    expect(server.requests({ method: 'delete' }).map((r) => r.url)).toEqual([`${API}/v1/items/2`]);
    expect(server.requests({ url: '/v1/items/:id' })).toHaveLength(2);
    expect(server.requests({ url: `${API}/v1/items/1` })).toHaveLength(1); // query ignored
    expect(server.requests({ url: 'https://other.test/*' })).toHaveLength(1);
    expect(server.requests({ url: '*/rails' })).toHaveLength(1);
    expect(server.requests({ url: /lang=en/ })).toHaveLength(1);
    expect(server.requests({ url: /lang=en/g })).toHaveLength(1);
    expect(server.requests({ method: 'GET', url: '/v1/items/:id' })).toHaveLength(1);
  });

  it('returns immutable snapshots', async () => {
    server.use(http.get('*', () => HttpResponse.text('ok')));
    await viaMock(server.url, '/x');
    const list = server.requests();
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(() => (list as unknown[]).push(1)).toThrow();
  });

  it('assigns unique ids under concurrency and answers every request correctly', async () => {
    server.use(
      http.get('*/mock/:n', async ({ params }) => {
        await delay(Math.floor(Math.random() * 20));
        return HttpResponse.json({ n: Number(params.n) });
      }),
    );
    const calls = Array.from({ length: 60 }, async (_, n) => {
      const res =
        n % 2 === 0
          ? await viaMock(server.url, `/mock/${n}`, { origin: API })
          : await viaMock(server.url, `/proxy/${n}`, { origin: upstream.origin });
      return { n, res, body: (await res.json()) as { n?: number; url?: string } };
    });
    const results = await Promise.all(calls);
    for (const { n, body } of results) {
      if (n % 2 === 0) expect(body.n).toBe(n);
      else expect(body.url).toBe(`/proxy/${n}`);
    }
    const records = server.requests();
    expect(records).toHaveLength(60);
    expect(new Set(records.map((r) => r.id)).size).toBe(60);
    expect(records.filter((r) => r.mocked)).toHaveLength(30);
    for (const { res } of results) {
      const id = res.headers.get('x-toets-request-id');
      expect(records.find((r) => r.id === id)?.status).toBe(200);
    }
  });

  it('isolates handler changes from requests already in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get('*/gated', async () => {
        await gate;
        return HttpResponse.text('old handler');
      }),
    );
    const pending = viaMock(server.url, '/gated');
    await until(() => server.requests().length === 1);
    server.resetHandlers(http.get('*/gated', () => HttpResponse.text('new handler')));
    release();
    expect(await (await pending).text()).toBe('old handler');
    expect(await (await viaMock(server.url, '/gated')).text()).toBe('new handler');
  });

  it('shows in-flight requests and does not re-add them after clearRequests()', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get('*/late', async () => {
        await gate;
        return HttpResponse.text('late');
      }),
    );
    const pending = viaMock(server.url, '/late');
    await until(() => server.requests().length === 1);
    expect(server.requests()[0]).toMatchObject({ status: null, durationMs: null, response: null });
    server.clearRequests();
    release();
    await (await pending).text();
    expect(server.requests()).toHaveLength(0);
  });

  it('caps recorded bodies but forwards them completely', async () => {
    const big = 'x'.repeat(200);
    const res = await viaMock(server.url, '/big', {
      origin: upstream.origin,
      method: 'POST',
      body: big,
    });
    expect(((await res.json()) as { body: string }).body).toBe(big);
    const record = server.requests()[0]!;
    expect(record.body).toBe('x'.repeat(64));
    expect(record.bodySize).toBe(200);
    expect(record.bodyTruncated).toBe(true);
    expect(record.response?.bodyTruncated).toBe(true);
    expect(record.response?.bodySize).toBeGreaterThan(200);
  });
});

describe('toHar()', () => {
  it('exports recorded traffic as HAR 1.2', async () => {
    server.use(
      http.post(`${API}/v1/login`, () =>
        HttpResponse.json({ token: 't' }, { headers: { 'set-cookie': 'sid=1; Path=/' } }),
      ),
      http.get(`${API}/v1/img`, () => HttpResponse.arrayBuffer(new Uint8Array([0, 255, 1]).buffer)),
    );
    await viaMock(server.url, '/v1/login?next=%2Fhome', {
      origin: API,
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'a=1; b=2' },
      body: '{"u":"ada"}',
    });
    await (await viaMock(server.url, '/v1/img', { origin: API })).arrayBuffer();
    await viaMock(server.url, '/v1/unrouted');

    const har = server.toHar();
    expect(JSON.parse(JSON.stringify(har))).toEqual(har);
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('@toets/mock');
    expect(har.log.entries).toHaveLength(3);

    const [login, img, unrouted] = har.log.entries;
    expect(login?.request).toMatchObject({
      method: 'POST',
      url: `${API}/v1/login?next=%2Fhome`,
      httpVersion: 'HTTP/1.1',
      queryString: [{ name: 'next', value: '/home' }],
      cookies: [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ],
      postData: { mimeType: 'application/json', text: '{"u":"ada"}' },
      bodySize: 11,
    });
    expect(login?.response).toMatchObject({
      status: 200,
      statusText: 'OK',
      cookies: [{ name: 'sid', value: '1' }],
      content: { mimeType: 'application/json', text: '{"token":"t"}', size: 13 },
    });
    expect(login?._toets).toMatchObject({ mocked: true, inFlight: false, error: null });
    expect(login?.timings.wait).toBeGreaterThanOrEqual(0);
    expect(login?.timings.receive).toBeGreaterThanOrEqual(0);
    expect(Date.parse(login?.startedDateTime ?? '')).not.toBeNaN();

    expect(img?.response.content).toMatchObject({ encoding: 'base64', text: 'AP8B', size: 3 });

    expect(unrouted?.response.status).toBe(502);
    expect(unrouted?._toets.error?.code).toBe('MOCK_NO_ORIGIN');
    expect(unrouted?.response._error).toContain('MOCK_NO_ORIGIN');
  });

  it('filters like requests() and reports dropped connections with status 0', async () => {
    server.use(http.get('*/drop', () => HttpResponse.error()));
    await viaMock(server.url, '/drop').catch(() => {});
    await viaMock(server.url, '/other').catch(() => {});
    const har = server.toHar({ url: '/drop' });
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]?.response).toMatchObject({ status: 0, bodySize: -1 });
    expect(har.log.entries[0]?.response._error).toContain('MOCK_NETWORK_ERROR');
  });
});
