import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ORIGINAL_ORIGIN_HEADER } from '@dpad-tv/protocol';

export interface UpstreamRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Buffer;
}

export interface Upstream {
  readonly origin: string;
  readonly received: UpstreamRequest[];
  close(): Promise<void>;
}

type Route = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void | Promise<void>;

/** A real HTTP server standing in for the app's backend. Unknown paths echo the request. */
export async function startUpstream(routes: Record<string, Route> = {}): Promise<Upstream> {
  const received: UpstreamRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routes[path];
    if (route) return route(req, res, body);
    res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' });
    res.end(JSON.stringify({ method: req.method, url: req.url, body: body.toString('utf8') }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Calls the mock server the way an integrated app does: mockUrl + path, origin in a header. */
export function viaMock(
  mockUrl: string,
  path: string,
  init: RequestInit & { origin?: string | null } = {},
): Promise<Response> {
  const { origin, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin) headers.set(ORIGINAL_ORIGIN_HEADER, origin);
  return fetch(mockUrl + path, { ...rest, headers });
}

/** Waits until `predicate` holds, polling briefly. */
export async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Sends a raw HTTP/1.1 request and resolves with the raw response text. */
export function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ connect }) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(text));
      let out = '';
      socket.on('data', (d) => (out += d.toString('latin1')));
      socket.on('end', () => resolve(out));
      socket.on('close', () => resolve(out));
      socket.on('error', reject);
    }, reject);
  });
}
