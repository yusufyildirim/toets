import type { IncomingMessage } from 'node:http';
import { ORIGINAL_ORIGIN_HEADER } from '@dpad-tv/protocol';

/** Response header carrying the recorded request id, for correlating app logs with records. */
export const REQUEST_ID_HEADER = 'x-dpad-request-id';
/** Response header naming the {@link MockErrorCode} of a response the mock server generated. */
export const ERROR_HEADER = 'x-dpad-error';

/** Connection-scoped headers (RFC 9110 7.6.1) that must not be forwarded by a proxy. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  'http2-settings',
]);

/** Header names listed in a `Connection` header are hop-by-hop too. */
function connectionTokens(value: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const token of (value ?? '').split(',')) {
    const t = token.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

/** Request headers as the app sent them: lowercase names, repeats joined (cookies with `; `). */
export function recordRequestHeaders(req: IncomingMessage): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!.toLowerCase();
    const value = raw[i + 1]!;
    const prev = out[name];
    out[name] = prev === undefined ? value : `${prev}${name === 'cookie' ? '; ' : ', '}${value}`;
  }
  return Object.freeze(out);
}

/**
 * Headers handlers and the upstream see: what the real origin would receive if the app had
 * called it directly. Drops hop-by-hop headers and the dpad origin header, sets `host`.
 */
export function forwardRequestHeaders(req: IncomingMessage, host: string): Array<[string, string]> {
  const drop = connectionTokens(headerValue(req, 'connection'));
  const out: Array<[string, string]> = [];
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!.toLowerCase();
    if (HOP_BY_HOP.has(name) || drop.has(name)) continue;
    if (name === 'host' || name === ORIGINAL_ORIGIN_HEADER || name === 'content-length') continue;
    out.push([name, raw[i + 1]!]);
  }
  out.push(['host', host]);
  return out;
}

/**
 * Response headers forwarded to the app: drops hop-by-hop headers (framing is re-done by the
 * mock server) and upstream CORS headers (replaced by permissive ones).
 */
export function filterResponseHeaders(pairs: Iterable<[string, string]>): Array<[string, string]> {
  const list = [...pairs].map(([n, v]): [string, string] => [n.toLowerCase(), v]);
  const drop = connectionTokens(list.find(([n]) => n === 'connection')?.[1]);
  return list.filter(
    ([name]) => !HOP_BY_HOP.has(name) && !drop.has(name) && !name.startsWith('access-control-'),
  );
}

export function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Permissive CORS for actual (non-preflight) responses. Echoes the request origin so
 * credentialed requests work, and exposes every response header to scripts.
 */
export function corsHeaders(
  req: IncomingMessage,
  responseHeaderNames: Iterable<string>,
): Array<[string, string]> {
  const origin = headerValue(req, 'origin');
  const exposed = new Set<string>();
  for (const name of responseHeaderNames) {
    if (name !== 'set-cookie' && name !== 'set-cookie2') exposed.add(name);
  }
  exposed.add(REQUEST_ID_HEADER);
  exposed.add(ERROR_HEADER);
  const out: Array<[string, string]> = [];
  if (origin) {
    out.push(['access-control-allow-origin', origin], ['access-control-allow-credentials', 'true']);
    out.push(['vary', 'Origin']);
  } else {
    out.push(['access-control-allow-origin', '*']);
  }
  out.push(['access-control-expose-headers', [...exposed].join(', ')]);
  return out;
}

/** True for a CORS preflight: `OPTIONS` with `Access-Control-Request-Method`. */
export function isPreflight(req: IncomingMessage): boolean {
  return req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined;
}

/**
 * Answers a CORS preflight allowing everything that was asked for, including Chrome's
 * Private Network Access (public page calling `localhost`).
 */
export function preflightHeaders(req: IncomingMessage): Array<[string, string]> {
  const origin = headerValue(req, 'origin');
  const method = headerValue(req, 'access-control-request-method') ?? 'GET';
  const requested = headerValue(req, 'access-control-request-headers');
  const out: Array<[string, string]> = [
    ['access-control-allow-origin', origin ?? '*'],
    ['access-control-allow-methods', `${method}, GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`],
    ['access-control-max-age', '600'],
    ['vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'],
    ['content-length', '0'],
  ];
  if (origin) out.push(['access-control-allow-credentials', 'true']);
  if (requested) out.push(['access-control-allow-headers', requested]);
  if (headerValue(req, 'access-control-request-private-network') === 'true') {
    out.push(['access-control-allow-private-network', 'true']);
  }
  return out;
}
