import http, { STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { DpadError } from '@dpad-tv/core';
import { ORIGINAL_ORIGIN_HEADER } from '@dpad-tv/protocol';
import { getResponse, isPassthroughResponse, type RequestHandler } from 'msw';
import { BodyCapture } from './body.js';
import {
  MockErrorCode,
  badOriginError,
  badRequestError,
  handlerError,
  internalError,
  invalidHandlerError,
  invalidOptionError,
  listenError,
  messageOf,
  noOriginError,
  portInUseError,
  unhandledError,
  upstreamError,
} from './errors.js';
import { toHar, type Har } from './har.js';
import {
  ERROR_HEADER,
  REQUEST_ID_HEADER,
  corsHeaders,
  filterResponseHeaders,
  forwardRequestHeaders,
  headerValue,
  isPreflight,
  preflightHeaders,
  recordRequestHeaders,
} from './headers.js';
import {
  Exchange,
  compileFilter,
  type RecordedMockError,
  type RecordedMockRequest,
  type RequestFilter,
} from './record.js';

/** Options for {@link createMockServer}. */
export interface MockServerOptions {
  /** Port to listen on. Default `0`: the OS picks a free port (recommended). */
  readonly port?: number;
  /**
   * Baseline handlers, active for every test. `resetHandlers()` returns to exactly this list,
   * so per-test handlers added with `use()` never leak into the next test.
   */
  readonly handlers?: readonly RequestHandler[];
  /**
   * What to do with a request no handler answers. `'proxy'` (default) forwards it to the
   * origin named by the origin header; `'reject'` answers 502 `MOCK_UNHANDLED`, which keeps a
   * suite hermetic.
   */
  readonly onUnhandledRequest?: 'proxy' | 'reject';
  /**
   * Max bytes recorded per request or response body (the full body is always forwarded).
   * Default 1 MiB.
   */
  readonly maxRecordedBodyBytes?: number;
}

/**
 * A host-side HTTP server that answers the app's API traffic with MSW handlers, proxies
 * everything else to the real origin and records every exchange.
 *
 * Isolation model: one server per test worker (it is cheap, but the app is launched with its
 * URL), handlers and recordings reset per test with `resetHandlers()` and `clearRequests()`.
 * Requests are handled concurrently; each request resolves against the handler list as it was
 * when the request arrived.
 */
export interface MockServer {
  /** Base URL the app sends API traffic to, e.g. `http://localhost:53124`. No trailing slash. */
  readonly url: string;
  readonly port: number;
  /**
   * Prepends handlers for the current test. Within one call the first handler wins; across
   * calls the most recently added wins. Throws `MOCK_INVALID_HANDLER` for non-handlers.
   */
  use(...handlers: RequestHandler[]): void;
  /**
   * Removes handlers added with `use()`, returning to the baseline handlers (re-arming
   * `{ once: true }` ones). With arguments, replaces the active list with `nextHandlers`
   * (the baseline itself stays unchanged).
   */
  resetHandlers(...nextHandlers: RequestHandler[]): void;
  /**
   * Recorded requests in arrival order, including in-flight ones (`status: null`). CORS
   * preflights are answered automatically and not recorded.
   */
  requests(filter?: RequestFilter): readonly RecordedMockRequest[];
  /** Forgets recorded requests. In-flight requests that complete later are not re-added. */
  clearRequests(): void;
  /** Recorded traffic as a HAR 1.2 log, e.g. to attach to a test report. */
  toHar(filter?: RequestFilter): Har;
  /** Stops listening, drops open connections and aborts in-flight work. Idempotent. */
  close(): Promise<void>;
}

/**
 * Starts a mock server on the loopback interface (`127.0.0.1` and, when available, `::1`).
 *
 * @example
 * const server = await createMockServer();
 * server.use(http.get('https://api.example.com/v1/me', () => HttpResponse.json({ name: 'Ada' })));
 * // launch the app with { mockUrl: server.url } ...
 * expect(server.requests({ url: '/v1/me' })).toHaveLength(1);
 * await server.close();
 */
export async function createMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const port = opts.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw invalidOptionError('port', port, 'an integer between 0 and 65535');
  }
  const limit = opts.maxRecordedBodyBytes ?? DEFAULT_BODY_LIMIT;
  if (!Number.isInteger(limit) || limit < 0) {
    throw invalidOptionError('maxRecordedBodyBytes', limit, 'a non-negative integer');
  }
  const unhandled = opts.onUnhandledRequest ?? 'proxy';
  if (unhandled !== 'proxy' && unhandled !== 'reject') {
    throw invalidOptionError('onUnhandledRequest', unhandled, "'proxy' or 'reject'");
  }
  const server = new MockServerImpl(assertHandlers(opts.handlers ?? []), unhandled, limit);
  await server.listen(port);
  return server;
}

const DEFAULT_BODY_LIMIT = 1024 * 1024;

class MockServerImpl implements MockServer {
  url = '';
  port = 0;
  private servers: http.Server[] = [];
  private handlers: RequestHandler[];
  private exchanges: Exchange[] = [];
  private seq = 0;
  private readonly inflight = new Set<AbortController>();
  private closing: Promise<void> | null = null;
  private readonly httpAgent = new http.Agent({ keepAlive: true });
  private readonly httpsAgent = new https.Agent({ keepAlive: true });

  constructor(
    private readonly baseline: readonly RequestHandler[],
    private readonly onUnhandled: 'proxy' | 'reject',
    private readonly bodyLimit: number,
  ) {
    this.handlers = [...baseline];
  }

  use(...handlers: RequestHandler[]): void {
    this.handlers = [...assertHandlers(handlers), ...this.handlers];
  }

  resetHandlers(...nextHandlers: RequestHandler[]): void {
    const next = nextHandlers.length > 0 ? assertHandlers(nextHandlers) : [...this.baseline];
    for (const handler of this.handlers) {
      if (!next.includes(handler)) handler.reset?.();
    }
    for (const handler of next) handler.restore?.();
    this.handlers = next;
  }

  requests(filter?: RequestFilter): readonly RecordedMockRequest[] {
    const match = compileFilter(filter);
    return Object.freeze(this.exchanges.filter(match).map((e) => e.snapshot()));
  }

  clearRequests(): void {
    this.exchanges = [];
  }

  toHar(filter?: RequestFilter): Har {
    return toHar(this.exchanges.filter(compileFilter(filter)));
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      for (const controller of this.inflight) controller.abort(new Error('mock server closed'));
      await Promise.all(
        this.servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            }),
        ),
      );
      this.httpAgent.destroy();
      this.httpsAgent.destroy();
    })();
    return this.closing;
  }

  /**
   * Binds 127.0.0.1 and ::1 on the same port so `localhost` works whichever address family a
   * client resolves first. Never binds non-loopback interfaces: the server is an open proxy.
   */
  async listen(port: number): Promise<void> {
    const attempts = port === 0 ? 5 : 1;
    for (let attempt = 1; ; attempt++) {
      const v4 = this.createHttpServer();
      try {
        await listenOn(v4, port, '127.0.0.1');
      } catch (error) {
        throw isCode(error, 'EADDRINUSE') ? portInUseError(port, error) : listenError(error);
      }
      const actual = (v4.address() as { port: number }).port;
      const v6 = this.createHttpServer();
      try {
        await listenOn(v6, actual, '::1');
        this.servers = [v4, v6];
      } catch (error) {
        if (isCode(error, 'EADDRNOTAVAIL') || isCode(error, 'EAFNOSUPPORT')) {
          this.servers = [v4]; // no IPv6 loopback on this host
        } else {
          await closeServer(v4);
          if (isCode(error, 'EADDRINUSE')) {
            if (attempt < attempts) continue;
            throw portInUseError(actual, error);
          }
          throw listenError(error);
        }
      }
      this.port = actual;
      this.url = `http://localhost:${actual}`;
      return;
    }
  }

  private createHttpServer(): http.Server {
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on('upgrade', (_req: IncomingMessage, socket: Duplex) => {
      socket.end(
        'HTTP/1.1 501 Not Implemented\r\nconnection: close\r\ncontent-type: text/plain\r\n\r\n' +
          'The dpad mock server does not proxy WebSocket or other protocol upgrades.',
      );
    });
    return server;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (isPreflight(req)) {
      res.writeHead(204, 'No Content', preflightHeaders(req).flat());
      res.end();
      return;
    }
    const controller = new AbortController();
    this.inflight.add(controller);
    res.once('close', () => {
      if (!res.writableFinished) controller.abort(new Error('the app closed the connection'));
    });
    try {
      await this.process(req, res, controller.signal);
    } catch {
      // Unreachable in practice (process() answers its own failures); never crash the worker.
      if (!res.headersSent) res.writeHead(500, 'Internal Server Error').end();
      else res.destroy();
    } finally {
      this.inflight.delete(controller);
    }
  }

  private async process(
    req: IncomingMessage,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const path = requestPath(req.url ?? '/');
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      return; // the app went away mid-upload; nothing to answer
    }

    const rawOrigin = headerValue(req, ORIGINAL_ORIGIN_HEADER);
    const origin = rawOrigin === undefined ? null : parseOrigin(rawOrigin);
    const url = new URL(path, origin ?? this.url);
    const exchange = new Exchange(
      String(++this.seq),
      method,
      url.href,
      recordRequestHeaders(req),
      Date.now(),
      BodyCapture.of(body, this.bodyLimit),
      req.httpVersion,
      this.bodyLimit,
    );
    this.exchanges.push(exchange);
    // While a body streams, pipeBody() owns the outcome (it can tell an app abort from a failure).
    const onAbort = () => {
      if (!exchange.streaming) exchange.finish(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    try {
      await this.route(req, res, exchange, { method, path, url, rawOrigin, origin, body }, signal);
    } catch (error) {
      // Defensive: route() handles expected failures. Anything else is answered, never thrown.
      if (!res.headersSent) {
        this.sendError(req, res, exchange, 500, internalError(method, url.href, error));
      } else {
        exchange.finish({ code: MockErrorCode.RESPONSE_FAILED, message: messageOf(error) });
        res.destroy();
      }
    }
  }

  private async route(
    req: IncomingMessage,
    res: ServerResponse,
    exchange: Exchange,
    { method, path, url, rawOrigin, origin, body }: RouteInput,
    signal: AbortSignal,
  ): Promise<void> {
    if (rawOrigin !== undefined && origin === null) {
      return this.sendError(req, res, exchange, 400, badOriginError(rawOrigin));
    }

    let request: Request;
    try {
      request = new Request(url, {
        method,
        headers: forwardRequestHeaders(req, url.host),
        body: canHaveBody(method) && body.byteLength > 0 ? new Uint8Array(body) : null,
        signal,
      });
    } catch (error) {
      return this.sendError(req, res, exchange, 400, badRequestError(method, path, error));
    }

    let response: Response | undefined;
    try {
      // Snapshot the list: a concurrent use()/resetHandlers() must not affect this request.
      response = await getResponse([...this.handlers], request, {
        baseUrl: url.origin,
        quiet: true,
      });
    } catch (error) {
      if (signal.aborted) return;
      return this.sendError(req, res, exchange, 500, handlerError(method, url.href, error));
    }
    if (signal.aborted) {
      void response?.body?.cancel().catch(() => {});
      return;
    }
    if (response && isPassthroughResponse(response)) response = undefined;

    if (response) {
      exchange.mocked = true;
      if (response.type === 'error') {
        exchange.finish({
          code: MockErrorCode.NETWORK_ERROR,
          message: 'A handler returned HttpResponse.error(); the connection was dropped.',
        });
        res.destroy();
        return;
      }
      return this.sendMocked(req, res, exchange, response, signal);
    }
    if (!origin) return this.sendError(req, res, exchange, 502, noOriginError(method, path));
    if (this.onUnhandled === 'reject') {
      return this.sendError(req, res, exchange, 502, unhandledError(method, url.href));
    }
    return this.proxy(req, res, exchange, url, body, signal);
  }

  private async sendMocked(
    req: IncomingMessage,
    res: ServerResponse,
    exchange: Exchange,
    response: Response,
    signal: AbortSignal,
  ): Promise<void> {
    const pairs: Array<[string, string]> = [];
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') pairs.push([name, value]);
    });
    for (const cookie of response.headers.getSetCookie()) pairs.push(['set-cookie', cookie]);
    const declared = contentLength(pairs);
    const noBody = !responseHasBody(req.method, response.status);
    this.writeHead(req, res, exchange, response.status, response.statusText, pairs);
    const source = noBody || !response.body ? null : webToNode(response.body);
    if (noBody) void response.body?.cancel().catch(() => {});
    await this.pipeBody(res, exchange, source, noBody ? null : declared, signal);
  }

  private proxy(
    req: IncomingMessage,
    res: ServerResponse,
    exchange: Exchange,
    target: URL,
    body: Buffer,
    signal: AbortSignal,
  ): Promise<void> {
    const method = exchange.method;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of forwardRequestHeaders(req, target.host)) {
      const prev = headers[name];
      headers[name] = prev === undefined ? value : [...[prev].flat(), value];
    }
    // The body is buffered, so always send an exact length rather than re-chunking it.
    const hadBody =
      body.byteLength > 0 ||
      canHaveBody(method) ||
      req.headers['content-length'] !== undefined ||
      req.headers['transfer-encoding'] !== undefined;
    if (hadBody) headers['content-length'] = String(body.byteLength);

    const secure = target.protocol === 'https:';
    return new Promise<void>((resolve) => {
      let responded = false;
      const upstream = (secure ? https : http).request({
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[(.*)\]$/, '$1'),
        port: target.port || (secure ? 443 : 80),
        path: target.pathname + target.search,
        method,
        headers,
        agent: secure ? this.httpsAgent : this.httpAgent,
        signal,
      });
      upstream.on('response', (upstreamRes) => {
        responded = true;
        const pairs: Array<[string, string]> = [];
        const raw = upstreamRes.rawHeaders;
        for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i]!, raw[i + 1]!]);
        const status = upstreamRes.statusCode ?? 502;
        const noBody = !responseHasBody(method, status);
        this.writeHead(req, res, exchange, status, upstreamRes.statusMessage ?? '', pairs);
        if (noBody) upstreamRes.resume();
        // Node validates upstream framing (content-length / chunked) and errors on truncation.
        void this.pipeBody(res, exchange, noBody ? null : upstreamRes, null, signal).then(resolve);
      });
      upstream.on('error', (error) => {
        if (responded) return; // body failures are handled by pipeBody
        if (!signal.aborted) {
          this.sendError(req, res, exchange, 502, upstreamError(method, target.href, error));
        }
        resolve();
      });
      upstream.end(body);
    });
  }

  /**
   * Streams a body to the app with backpressure, recording a capped copy. Destroys the
   * connection when the body fails or contradicts its declared `content-length`, so the app
   * sees a network error instead of hanging or reading garbage.
   */
  private async pipeBody(
    res: ServerResponse,
    exchange: Exchange,
    source: Readable | null,
    declaredLength: number | null,
    signal: AbortSignal,
  ): Promise<void> {
    const capture = new BodyCapture(this.bodyLimit);
    exchange.responseBody = capture;
    exchange.streaming = true;
    let written = 0;
    let bodyError: Error | null = null;
    // Record a body failure the moment it happens, before the app observes the dropped socket.
    const failBody = (error: Error): Error => {
      if (!bodyError) {
        bodyError = error;
        exchange.finish({
          code: MockErrorCode.RESPONSE_FAILED,
          message: `The response body failed after headers were sent: ${messageOf(error)}`,
        });
      }
      return error;
    };
    source?.once('error', (error) => {
      // When the app hangs up, pipeline() destroys the source too; that is not a body failure.
      if (!signal.aborted) failBody(error);
    });
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.byteLength;
        if (declaredLength !== null && written > declaredLength) {
          callback(failBody(lengthError(declaredLength, written, 'more')));
          return;
        }
        capture.push(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        if (declaredLength !== null && written < declaredLength) {
          callback(failBody(lengthError(declaredLength, written, 'fewer')));
          return;
        }
        callback();
      },
    });
    try {
      await pipeline(source ?? Readable.from([]), tap, res);
      exchange.finish();
    } catch (error) {
      if (signal.aborted && !bodyError) exchange.finish(abortError(signal));
      else failBody(error as Error);
      res.destroy();
    }
  }

  private writeHead(
    req: IncomingMessage,
    res: ServerResponse,
    exchange: Exchange,
    status: number,
    statusText: string,
    pairs: Iterable<[string, string]>,
  ): void {
    const virtualOrigin = new URL(exchange.url).origin;
    const filtered = filterResponseHeaders(pairs).map(([name, value]): [string, string] =>
      name === 'location' ? [name, relativeLocation(value, virtualOrigin)] : [name, value],
    );
    const all: Array<[string, string]> = [
      ...filtered,
      ...corsHeaders(
        req,
        filtered.map(([name]) => name),
      ),
      [REQUEST_ID_HEADER, exchange.id],
    ];
    const text = statusText || STATUS_CODES[status] || 'Unknown';
    res.writeHead(status, text, all.flat());
    exchange.responseStarted(status, text, all);
  }

  /** Answers with a dpad error the app can log and a test can inspect via `requests()`. */
  private sendError(
    req: IncomingMessage,
    res: ServerResponse,
    exchange: Exchange,
    status: number,
    error: DpadError,
  ): void {
    if (exchange.done) return; // already settled, e.g. the app hung up
    exchange.error = { code: error.code, message: error.message };
    const body = Buffer.from(
      JSON.stringify({
        dpadError: { code: error.code, message: error.message, hint: error.hint, docs: error.docs },
      }),
    );
    if (res.headersSent || res.destroyed) {
      exchange.finish();
      return;
    }
    this.writeHead(req, res, exchange, status, '', [
      ['content-type', 'application/json; charset=utf-8'],
      ['content-length', String(body.byteLength)],
      ['cache-control', 'no-store'],
      [ERROR_HEADER, error.code],
    ]);
    exchange.responseBody = BodyCapture.of(body, this.bodyLimit);
    res.end(body);
    exchange.finish();
  }
}

interface RouteInput {
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly rawOrigin: string | undefined;
  readonly origin: string | null;
  readonly body: Buffer;
}

function assertHandlers(handlers: readonly unknown[]): RequestHandler[] {
  for (const handler of handlers) {
    // Duck-typed so handlers from another copy of msw still work.
    const h = handler as { kind?: unknown; run?: unknown } | null;
    if (
      typeof h !== 'object' ||
      h === null ||
      typeof h.run !== 'function' ||
      h.kind !== 'request'
    ) {
      throw invalidHandlerError(handler);
    }
  }
  return [...(handlers as RequestHandler[])];
}

/** Path and query of the request target (handles absolute-form targets too). */
function requestPath(target: string): string {
  try {
    const parsed = new URL(target, 'http://placeholder');
    return parsed.pathname + parsed.search;
  } catch {
    return '/';
  }
}

/** Returns the normalized origin, or null when the value is not a bare http(s) origin. */
function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function relativeLocation(location: string, origin: string): string {
  try {
    const resolved = new URL(location, origin);
    return resolved.origin === origin
      ? resolved.pathname + resolved.search + resolved.hash
      : location;
  } catch {
    return location;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function canHaveBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function responseHasBody(method: string | undefined, status: number): boolean {
  return method !== 'HEAD' && status !== 204 && status !== 304 && status >= 200;
}

function contentLength(pairs: ReadonlyArray<[string, string]>): number | null {
  const value = pairs.find(([name]) => name.toLowerCase() === 'content-length')?.[1];
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

function lengthError(declared: number, written: number, kind: 'more' | 'fewer'): Error {
  return new Error(
    `the body has ${kind} bytes (${written}${kind === 'more' ? '+' : ''}) than its content-length header (${declared})`,
  );
}

function webToNode(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>);
}

function abortError(signal: AbortSignal): RecordedMockError {
  const reason: unknown = signal.reason;
  const message = reason instanceof Error ? reason.message : 'aborted';
  return {
    code: MockErrorCode.CLIENT_ABORTED,
    message: `The request was aborted before it completed: ${message}.`,
  };
}

function isCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

function listenOn(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
