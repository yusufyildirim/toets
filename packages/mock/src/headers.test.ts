import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  corsHeaders,
  filterResponseHeaders,
  forwardRequestHeaders,
  isPreflight,
  recordRequestHeaders,
} from './headers.js';

function fakeRequest(method: string, raw: string[]): IncomingMessage {
  const headers: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!.toLowerCase();
    headers[name] = headers[name] ? `${headers[name]}, ${raw[i + 1]}` : raw[i + 1]!;
  }
  return { method, rawHeaders: raw, headers } as unknown as IncomingMessage;
}

describe('request headers', () => {
  const req = fakeRequest('POST', [
    'Host',
    'localhost:1234',
    'Connection',
    'keep-alive, X-Secret-Hop',
    'X-Secret-Hop',
    '1',
    'Cookie',
    'a=1',
    'Cookie',
    'b=2',
    'Accept',
    'text/html',
    'Accept',
    'application/json',
    'X-Dpad-Original-Origin',
    'https://api.example.test',
    'Content-Length',
    '3',
    'Transfer-Encoding',
    'chunked',
  ]);

  it('records headers as sent, joining repeats', () => {
    const recorded = recordRequestHeaders(req);
    expect(recorded.cookie).toBe('a=1; b=2');
    expect(recorded.accept).toBe('text/html, application/json');
    expect(recorded['x-dpad-original-origin']).toBe('https://api.example.test');
  });

  it('forwards what the real origin should see', () => {
    const forwarded = forwardRequestHeaders(req, 'api.example.test');
    const names = forwarded.map(([n]) => n);
    expect(names).not.toContain('connection');
    expect(names).not.toContain('x-secret-hop');
    expect(names).not.toContain('x-dpad-original-origin');
    expect(names).not.toContain('content-length');
    expect(names).not.toContain('transfer-encoding');
    expect(forwarded.filter(([n]) => n === 'host')).toEqual([['host', 'api.example.test']]);
    expect(forwarded.filter(([n]) => n === 'cookie')).toHaveLength(2);
  });
});

describe('response headers', () => {
  it('drops hop-by-hop and upstream CORS headers', () => {
    const out = filterResponseHeaders([
      ['Connection', 'close, X-Drop'],
      ['X-Drop', '1'],
      ['Transfer-Encoding', 'chunked'],
      ['Access-Control-Allow-Origin', 'https://x.test'],
      ['Content-Type', 'text/plain'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ]);
    expect(out).toEqual([
      ['content-type', 'text/plain'],
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ]);
  });

  it('never exposes set-cookie', () => {
    const cors = corsHeaders(fakeRequest('GET', []), ['set-cookie', 'x-a']);
    const exposed = cors.find(([n]) => n === 'access-control-expose-headers')?.[1];
    expect(exposed).toContain('x-a');
    expect(exposed).not.toContain('set-cookie');
  });
});

describe('isPreflight', () => {
  it('requires OPTIONS with access-control-request-method', () => {
    expect(isPreflight(fakeRequest('OPTIONS', ['Access-Control-Request-Method', 'GET']))).toBe(
      true,
    );
    expect(isPreflight(fakeRequest('OPTIONS', []))).toBe(false);
    expect(isPreflight(fakeRequest('GET', ['Access-Control-Request-Method', 'GET']))).toBe(false);
  });
});
