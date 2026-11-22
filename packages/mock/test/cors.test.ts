import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer, http, HttpResponse, type MockServer } from '../src/index.js';

let server: MockServer;

beforeAll(async () => {
  server = await createMockServer({
    handlers: [
      http.get('*/data', () =>
        HttpResponse.json({ ok: true }, { headers: { 'x-total-count': '3' } }),
      ),
    ],
  });
});
afterAll(() => server.close());

describe('CORS', () => {
  it('answers preflights itself, allowing what was asked, without recording them', async () => {
    const res = await fetch(`${server.url}/data`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://tv.example.test',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'x-dpad-original-origin, authorization',
        'access-control-request-private-network': 'true',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tv.example.test');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'x-dpad-original-origin, authorization',
    );
    expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    expect(server.requests()).toHaveLength(0);
  });

  it('lets plain OPTIONS requests reach handlers', async () => {
    server.use(
      http.options(
        '*/data',
        () => new HttpResponse(null, { status: 200, headers: { allow: 'GET' } }),
      ),
    );
    const res = await fetch(`${server.url}/data`, { method: 'OPTIONS' });
    expect(res.headers.get('allow')).toBe('GET');
    expect(server.requests()).toHaveLength(1);
    server.resetHandlers();
    server.clearRequests();
  });

  it('echoes the origin and exposes every response header', async () => {
    const res = await fetch(`${server.url}/data`, { headers: { origin: 'http://localhost:8080' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8080');
    expect(res.headers.get('vary')).toContain('Origin');
    const exposed = res.headers.get('access-control-expose-headers') ?? '';
    expect(exposed).toContain('x-total-count');
    expect(exposed).toContain('x-dpad-request-id');
  });

  it('uses a wildcard origin when the request has none', async () => {
    const res = await fetch(`${server.url}/data`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
