import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { createMockServer, http, HttpResponse, latency, MockErrorCode } from '../src/index.js';
import { rawRequest, startUpstream, until, viaMock } from './helpers.js';

async function ipv6Available(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::1', () => probe.close(() => resolve(true)));
  });
}

describe('lifecycle', () => {
  it('listens on a free localhost port and exposes url/port', async () => {
    const server = await createMockServer();
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://localhost:${server.port}`);
      server.use(http.get('*/ping', () => HttpResponse.text('pong')));
      expect(await (await fetch(`http://127.0.0.1:${server.port}/ping`)).text()).toBe('pong');
      if (await ipv6Available()) {
        expect(await (await fetch(`http://[::1]:${server.port}/ping`)).text()).toBe('pong');
      }
    } finally {
      await server.close();
    }
  });

  it('runs isolated servers side by side (one per worker)', async () => {
    const [a, b] = await Promise.all([createMockServer(), createMockServer()]);
    try {
      a.use(http.get('*/who', () => HttpResponse.text('a')));
      b.use(http.get('*/who', () => HttpResponse.text('b')));
      expect(await (await viaMock(a.url, '/who')).text()).toBe('a');
      expect(await (await viaMock(b.url, '/who')).text()).toBe('b');
      expect(a.requests()).toHaveLength(1);
      expect(b.requests()).toHaveLength(1);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('honors an explicit port and reports MOCK_PORT_IN_USE when taken', async () => {
    const first = await createMockServer();
    try {
      const again = await createMockServer({ port: first.port }).catch((e: unknown) => e);
      expect(again).toMatchObject({ code: MockErrorCode.PORT_IN_USE });
      expect(String(again)).toContain('Hint:');
    } finally {
      await first.close();
    }
    const fixed = await createMockServer({ port: first.port });
    expect(fixed.port).toBe(first.port);
    await fixed.close();
  });

  it('validates options', async () => {
    await expect(createMockServer({ port: -1 })).rejects.toMatchObject({
      code: MockErrorCode.INVALID_OPTION,
    });
    await expect(createMockServer({ maxRecordedBodyBytes: 1.5 })).rejects.toMatchObject({
      code: MockErrorCode.INVALID_OPTION,
    });
    await expect(createMockServer({ handlers: ['nope' as never] })).rejects.toMatchObject({
      code: MockErrorCode.INVALID_HANDLER,
    });
  });

  it('close() is idempotent, aborts hanging requests and keeps recordings readable', async () => {
    const server = await createMockServer();
    server.use(latency('infinite'));
    const pending = viaMock(server.url, '/hang').catch((e: unknown) => e);
    await until(() => server.requests().length === 1);
    await Promise.all([server.close(), server.close()]);
    expect(await pending).toBeInstanceOf(Error);
    expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.CLIENT_ABORTED);
    expect(server.toHar().log.entries).toHaveLength(1);
    await expect(fetch(`${server.url}/x`)).rejects.toThrow();
  });

  it('close() aborts in-flight proxied requests', async () => {
    let upstreamClosed = false;
    const upstream = await startUpstream({
      '/hang': (req) => {
        req.socket.on('close', () => (upstreamClosed = true));
      },
    });
    const server = await createMockServer();
    const pending = viaMock(server.url, '/hang', { origin: upstream.origin }).catch(
      (e: unknown) => e,
    );
    await until(() => upstream.received.length === 1);
    await server.close();
    expect(await pending).toBeInstanceOf(Error);
    await until(() => upstreamClosed);
    await upstream.close();
  });

  it('answers protocol upgrades with 501', async () => {
    const server = await createMockServer();
    try {
      const response = await rawRequest(
        server.port,
        'GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      );
      expect(response).toMatch(/^HTTP\/1.1 501/);
      expect(response).toContain('WebSocket');
    } finally {
      await server.close();
    }
  });

  it('records an app abort while a mocked stream is open', async () => {
    const server = await createMockServer();
    try {
      server.use(
        http.get('*/events', () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
            },
          });
          return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
        }),
      );
      const controller = new AbortController();
      const res = await viaMock(server.url, '/events', { signal: controller.signal });
      await res.body!.getReader().read();
      controller.abort();
      await until(() => server.requests()[0]?.durationMs != null);
      expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.CLIENT_ABORTED);
      expect(server.requests()[0]?.response?.body).toBe('data: 1\n\n');
    } finally {
      await server.close();
    }
  });
});
