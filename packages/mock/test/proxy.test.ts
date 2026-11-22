import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer, ERROR_HEADER, MockErrorCode, type MockServer } from '../src/index.js';
import { startUpstream, viaMock, type Upstream } from './helpers.js';

let server: MockServer;
let upstream: Upstream;
let releaseStream: () => void = () => {};

beforeAll(async () => {
  server = await createMockServer();
  upstream = await startUpstream({
    '/gzip': (_req, res) => {
      const body = gzipSync(JSON.stringify({ zipped: true }));
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': body.byteLength,
      });
      res.end(body);
    },
    '/binary': (_req, res, body) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.concat([body, Buffer.from([0xff, 0x00, 0xfe])]));
    },
    '/stream': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first;');
      new Promise<void>((r) => (releaseStream = r)).then(() => res.end('second'));
    },
    '/reset': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' });
      res.write('partial');
      setTimeout(() => res.socket?.destroy(), 10);
    },
    '/cors': (_req, res) => {
      res.writeHead(200, {
        'access-control-allow-origin': 'https://not-you.test',
        'x-custom': 'visible',
      });
      res.end('ok');
    },
    '/redirect': (_req, res) => {
      res.writeHead(301, { location: '/target?b=2' });
      res.end();
    },
    '/head': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '42' });
      res.end();
    },
    '/headers': (req, res) => {
      res.writeHead(200, {
        connection: 'keep-alive, x-hop',
        'x-hop': 'should be dropped',
        'keep-alive': 'timeout=99',
        'x-kept': 'yes',
      });
      res.end(JSON.stringify(req.headers));
    },
  });
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

describe('upstream proxy', () => {
  it('forwards unmatched requests to the original origin, preserving method, path, query and body', async () => {
    const res = await viaMock(server.url, '/v1/echo?a=1&b=two', {
      origin: upstream.origin,
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'x-app': 'tv' },
      body: 'hello',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-upstream')).toBe('yes');
    expect(await res.json()).toEqual({ method: 'PUT', url: '/v1/echo?a=1&b=two', body: 'hello' });

    const received = upstream.received[0]!;
    expect(received.headers.host).toBe(new URL(upstream.origin).host);
    expect(received.headers['x-app']).toBe('tv');
    expect(received.headers['x-dpad-original-origin']).toBeUndefined();
    expect(received.headers['content-length']).toBe('5');

    expect(server.requests()[0]).toMatchObject({
      method: 'PUT',
      url: `${upstream.origin}/v1/echo?a=1&b=two`,
      mocked: false,
      status: 200,
      body: 'hello',
      error: null,
    });
  });

  it('round-trips binary request and response bodies byte for byte', async () => {
    const payload = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7) % 256));
    const res = await viaMock(server.url, '/binary', {
      origin: upstream.origin,
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
    });
    const out = Buffer.from(await res.arrayBuffer());
    expect(out).toEqual(Buffer.concat([payload, Buffer.from([0xff, 0x00, 0xfe])]));
    expect(upstream.received[0]?.body).toEqual(payload);

    const record = server.requests()[0]!;
    expect(record.bodyEncoding).toBe('base64');
    expect(Buffer.from(record.body!, 'base64')).toEqual(payload);
    expect(record.response?.bodyEncoding).toBe('base64');
    expect(record.response?.bodySize).toBe(payload.byteLength + 3);
  });

  it('passes compressed responses through untouched and records them decoded', async () => {
    const res = await viaMock(server.url, '/gzip', { origin: upstream.origin });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await res.json()).toEqual({ zipped: true });
    const response = server.requests()[0]?.response;
    expect(response?.body).toBe('{"zipped":true}');
    expect(response?.headers['content-encoding']).toBe('gzip');
  });

  it('streams upstream responses without buffering them', async () => {
    const res = await viaMock(server.url, '/stream', { origin: upstream.origin });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('first;');
    expect(server.requests()[0]?.durationMs).toBeNull(); // still in flight
    releaseStream();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toBe('second');
    expect(server.requests()[0]?.response?.body).toBe('first;second');
  });

  it('drops the app connection when the upstream dies mid-body', async () => {
    const res = await viaMock(server.url, '/reset', { origin: upstream.origin });
    await expect(res.text()).rejects.toThrow();
    expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.RESPONSE_FAILED);
  });

  it('answers 502 MOCK_UPSTREAM_UNREACHABLE when the origin is down', async () => {
    const dead = await startUpstream();
    await dead.close();
    const res = await viaMock(server.url, '/v1/x', { origin: dead.origin });
    expect(res.status).toBe(502);
    expect(res.headers.get(ERROR_HEADER)).toBe(MockErrorCode.UPSTREAM_UNREACHABLE);
    const body = (await res.json()) as { dpadError: { message: string } };
    expect(body.dpadError.message).toContain('ECONNREFUSED');
    expect(server.requests()[0]?.error?.code).toBe(MockErrorCode.UPSTREAM_UNREACHABLE);
  });

  it('replaces upstream CORS headers with permissive ones', async () => {
    const res = await viaMock(server.url, '/cors', {
      origin: upstream.origin,
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-expose-headers')).toContain('x-custom');
  });

  it('keeps same-origin upstream redirects on the mock server', async () => {
    const res = await viaMock(server.url, '/redirect', {
      origin: upstream.origin,
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/target?b=2');
  });

  it('keeps content-length on HEAD responses without sending a body', async () => {
    const res = await viaMock(server.url, '/head', { origin: upstream.origin, method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('42');
    expect(server.requests()[0]?.error).toBeNull();
  });

  it('strips hop-by-hop headers in both directions', async () => {
    const res = await viaMock(server.url, '/headers', {
      origin: upstream.origin,
      headers: { 'x-trace': '1' },
    });
    expect(res.headers.get('x-kept')).toBe('yes');
    expect(res.headers.get('x-hop')).toBeNull();
    expect(res.headers.get('keep-alive')).not.toBe('timeout=99');
    const seen = (await res.json()) as Record<string, string>;
    expect(seen['x-trace']).toBe('1');
    expect(seen['x-dpad-original-origin']).toBeUndefined();
  });

  it('rejects unmatched requests instead of proxying with onUnhandledRequest: reject', async () => {
    const strict = await createMockServer({ onUnhandledRequest: 'reject' });
    try {
      const res = await viaMock(strict.url, '/v1/x', { origin: upstream.origin });
      expect(res.status).toBe(502);
      expect(res.headers.get(ERROR_HEADER)).toBe(MockErrorCode.UNHANDLED);
      expect(upstream.received).toHaveLength(0);
    } finally {
      await strict.close();
    }
  });
});
