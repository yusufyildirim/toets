import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createMockServer,
  delay,
  ERROR_HEADER,
  http,
  HttpResponse,
  MockErrorCode,
  passthrough,
  REQUEST_ID_HEADER,
  type MockServer,
} from '../src/index.js';
import { startUpstream, viaMock, type Upstream } from './helpers.js';

const API = 'https://api.example.test';

let server: MockServer;
let upstream: Upstream;

beforeAll(async () => {
  server = await createMockServer({
    handlers: [http.get('*/baseline', () => HttpResponse.json({ from: 'baseline' }))],
  });
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

describe('mocked responses', () => {
  it('answers from a handler matching the original origin and records it', async () => {
    server.use(http.get(`${API}/v1/me`, () => HttpResponse.json({ name: 'Ada' })));
    const res = await viaMock(server.url, '/v1/me?x=1', { origin: API });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Ada' });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(server.requests()[0]?.id);

    const [record] = server.requests();
    expect(record).toMatchObject({
      method: 'GET',
      url: `${API}/v1/me?x=1`,
      mocked: true,
      status: 200,
      body: null,
      error: null,
    });
    expect(record?.headers['x-dpad-original-origin']).toBe(API);
    expect(record?.response?.body).toBe('{"name":"Ada"}');
    expect(record?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('matches relative handler paths on any origin, also without the origin header', async () => {
    server.use(http.get('/v1/items/:id', ({ params }) => HttpResponse.json({ id: params.id })));
    expect(await (await viaMock(server.url, '/v1/items/7', { origin: API })).json()).toEqual({
      id: '7',
    });
    expect(await (await viaMock(server.url, '/v1/items/8')).json()).toEqual({ id: '8' });
    expect(server.requests().map((r) => r.url)).toEqual([
      `${API}/v1/items/7`,
      `${server.url}/v1/items/8`,
    ]);
  });

  it('gives handlers the request as the real origin would see it', async () => {
    let seen: { host: string | null; dpad: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${API}/v1/login`, async ({ request }) => {
        seen = {
          host: request.headers.get('host'),
          dpad: request.headers.get('x-dpad-original-origin'),
          body: await request.json(),
        };
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const res = await viaMock(server.url, '/v1/login', {
      origin: API,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'ada' }),
    });
    expect(res.status).toBe(201);
    expect(seen).toEqual({ host: 'api.example.test', dpad: null, body: { user: 'ada' } });
    expect(server.requests()[0]?.body).toBe('{"user":"ada"}');
  });

  it('uses the most recently added handler and resets to the baseline', async () => {
    server.use(http.get('*/thing', () => HttpResponse.text('first')));
    server.use(http.get('*/thing', () => HttpResponse.text('second')));
    expect(await (await viaMock(server.url, '/thing')).text()).toBe('second');
    expect(await (await viaMock(server.url, '/baseline')).json()).toEqual({ from: 'baseline' });

    server.resetHandlers();
    const res = await viaMock(server.url, '/thing');
    expect(res.status).toBe(502);
    expect(await (await viaMock(server.url, '/baseline')).json()).toEqual({ from: 'baseline' });

    server.resetHandlers(http.get('*/only', () => HttpResponse.text('only')));
    expect(await (await viaMock(server.url, '/only')).text()).toBe('only');
    expect((await viaMock(server.url, '/baseline')).status).toBe(502);
  });

  it('re-arms baseline once-handlers on reset', async () => {
    const once = await createMockServer({
      handlers: [http.get('*/once', () => HttpResponse.text('once'), { once: true })],
    });
    try {
      expect((await viaMock(once.url, '/once')).status).toBe(200);
      expect((await viaMock(once.url, '/once')).status).toBe(502);
      once.resetHandlers();
      expect((await viaMock(once.url, '/once')).status).toBe(200);
    } finally {
      await once.close();
    }
  });

  it('serves binary mocked bodies byte for byte', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    server.use(
      http.get('*/blob', () =>
        HttpResponse.arrayBuffer(bytes.buffer, {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    );
    const res = await viaMock(server.url, '/blob', { origin: API });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const record = server.requests()[0];
    expect(record?.response?.bodyEncoding).toBe('base64');
    expect(Buffer.from(record?.response?.body ?? '', 'base64')).toEqual(Buffer.from(bytes));
    expect(record?.response?.bodySize).toBe(256);
  });

  it('streams mocked ReadableStream bodies', async () => {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    server.use(
      http.get('*/stream', () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('one;'));
            await released;
            controller.enqueue(encoder.encode('two'));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'content-type': 'text/plain' } });
      }),
    );
    const res = await viaMock(server.url, '/stream');
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('one;');
    release();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toBe('two');
    expect(server.requests()[0]?.response?.body).toBe('one;two');
  });

  it('forwards multiple set-cookie headers', async () => {
    server.use(
      http.get('*/cookies', () => {
        const headers = new Headers();
        headers.append('set-cookie', 'a=1; Path=/');
        headers.append('set-cookie', 'b=2; Path=/');
        return new HttpResponse('ok', { headers });
      }),
    );
    const res = await viaMock(server.url, '/cookies');
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('proxies a matched request when the handler returns passthrough()', async () => {
    server.use(http.get('*/pass', () => passthrough()));
    const res = await viaMock(server.url, '/pass', { origin: upstream.origin });
    expect(res.headers.get('x-upstream')).toBe('yes');
    expect(server.requests()[0]?.mocked).toBe(false);
  });

  it('honors delay() inside handlers', async () => {
    server.use(
      http.get('*/slow', async () => {
        await delay(80);
        return HttpResponse.text('late');
      }),
    );
    const started = performance.now();
    expect(await (await viaMock(server.url, '/slow')).text()).toBe('late');
    expect(performance.now() - started).toBeGreaterThanOrEqual(75);
  });

  it('rewrites same-origin redirects to stay on the mock server', async () => {
    server.use(
      http.get(
        `${API}/old`,
        () => new HttpResponse(null, { status: 302, headers: { location: `${API}/new?a=1` } }),
      ),
      http.get(
        `${API}/away`,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { location: 'https://cdn.example.test/x' },
          }),
      ),
    );
    const same = await viaMock(server.url, '/old', { origin: API, redirect: 'manual' });
    expect(same.headers.get('location')).toBe('/new?a=1');
    const cross = await viaMock(server.url, '/away', { origin: API, redirect: 'manual' });
    expect(cross.headers.get('location')).toBe('https://cdn.example.test/x');
  });
});

describe('failures served to the app', () => {
  it('answers 502 MOCK_NO_ORIGIN when nothing matches and there is no origin header', async () => {
    const res = await viaMock(server.url, '/v1/unknown?q=1');
    expect(res.status).toBe(502);
    expect(res.headers.get(ERROR_HEADER)).toBe(MockErrorCode.NO_ORIGIN);
    const body = (await res.json()) as {
      dpadError: { code: string; message: string; hint: string };
    };
    expect(body.dpadError.code).toBe('MOCK_NO_ORIGIN');
    expect(body.dpadError.message).toContain('GET /v1/unknown?q=1');
    expect(body.dpadError.hint).toContain('x-dpad-original-origin');
    expect(server.requests()[0]).toMatchObject({
      status: 502,
      mocked: false,
      error: { code: 'MOCK_NO_ORIGIN' },
    });
  });

  it('answers 400 MOCK_BAD_ORIGIN for an origin header that is not an origin', async () => {
    for (const origin of ['api.example.test', 'ftp://x.test', `${API}/v2`]) {
      const res = await viaMock(server.url, '/x', { origin });
      expect(res.status).toBe(400);
      expect(res.headers.get(ERROR_HEADER)).toBe(MockErrorCode.BAD_ORIGIN);
    }
  });

  it('answers 500 MOCK_HANDLER_ERROR when a handler throws', async () => {
    server.use(
      http.get('*/boom', () => {
        throw new Error('kaput');
      }),
    );
    const res = await viaMock(server.url, '/boom');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { dpadError: { message: string } };
    expect(body.dpadError.message).toContain('kaput');
    expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.HANDLER_ERROR);
  });

  it('drops the connection for HttpResponse.error()', async () => {
    server.use(http.get('*/net', () => HttpResponse.error()));
    await expect(viaMock(server.url, '/net')).rejects.toThrow();
    expect(server.requests()[0]).toMatchObject({
      mocked: true,
      status: null,
      response: null,
      error: { code: MockErrorCode.NETWORK_ERROR },
    });
  });

  it('drops the connection when a mocked body contradicts its content-length', async () => {
    server.use(
      http.get('*/short', () => new HttpResponse('abc', { headers: { 'content-length': '10' } })),
      http.get('*/long', () => new HttpResponse('abcdef', { headers: { 'content-length': '2' } })),
    );
    await expect(viaMock(server.url, '/short').then((r) => r.text())).rejects.toThrow();
    await expect(viaMock(server.url, '/long').then((r) => r.text())).rejects.toThrow();
    const errors = server.requests().map((r) => r.error?.code);
    expect(errors).toEqual([MockErrorCode.RESPONSE_FAILED, MockErrorCode.RESPONSE_FAILED]);
  });

  it('rejects non-handlers in use() with MOCK_INVALID_HANDLER', () => {
    expect(() => server.use((() => {}) as never)).toThrow(
      expect.objectContaining({ code: MockErrorCode.INVALID_HANDLER }),
    );
    expect(() => server.use({} as never)).toThrow(/Expected an MSW request handler/);
  });
});
