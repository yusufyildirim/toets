import { DpadError, docsLink } from '@dpad-tv/core';
import { ORIGINAL_ORIGIN_HEADER } from '@dpad-tv/protocol';

/**
 * Error codes raised or served by the mock server. Served errors reach the app as a JSON body
 * `{ "dpadError": { code, message, hint, docs } }` with an `x-dpad-error: <code>` header and are
 * recorded on the request (`RecordedMockRequest.error`).
 */
export const MockErrorCode = {
  /** No handler matched and the request has no origin header, so there is nowhere to proxy. */
  NO_ORIGIN: 'MOCK_NO_ORIGIN',
  /** The origin header is not an `http(s)` origin. */
  BAD_ORIGIN: 'MOCK_BAD_ORIGIN',
  /** The request could not be turned into a Fetch `Request` (e.g. unsupported method). */
  BAD_REQUEST: 'MOCK_BAD_REQUEST',
  /** No handler matched and the server runs with `onUnhandledRequest: 'reject'`. */
  UNHANDLED: 'MOCK_UNHANDLED',
  /** Proxying to the real upstream failed before a response arrived. */
  UPSTREAM_UNREACHABLE: 'MOCK_UPSTREAM_UNREACHABLE',
  /** A handler threw. */
  HANDLER_ERROR: 'MOCK_HANDLER_ERROR',
  /** A handler returned `HttpResponse.error()`: the connection is dropped on purpose. */
  NETWORK_ERROR: 'MOCK_NETWORK_ERROR',
  /** The response body failed after headers were sent (upstream reset, broken mock stream). */
  RESPONSE_FAILED: 'MOCK_RESPONSE_FAILED',
  /** The app closed the connection before the response completed. */
  CLIENT_ABORTED: 'MOCK_CLIENT_ABORTED',
  /** `use()` / `resetHandlers()` received something that is not an MSW request handler. */
  INVALID_HANDLER: 'MOCK_INVALID_HANDLER',
  /** An option passed to `createMockServer()`, `latency()` or `failure()` is invalid. */
  INVALID_OPTION: 'MOCK_INVALID_OPTION',
  /** The requested port is taken. */
  PORT_IN_USE: 'MOCK_PORT_IN_USE',
  /** The server could not start listening for another reason. */
  LISTEN_FAILED: 'MOCK_LISTEN_FAILED',
} as const;

export type MockErrorCode = (typeof MockErrorCode)[keyof typeof MockErrorCode];

const DOCS = {
  concepts: docsLink('mock/concepts'),
  handlers: docsLink('mock/writing-handlers'),
  integration: docsLink('mock/app-integration'),
  traps: docsLink('mock/tv-traps'),
};

export function noOriginError(method: string, path: string): DpadError {
  return new DpadError(
    MockErrorCode.NO_ORIGIN,
    `${method} ${path} matched no mock handler and has no "${ORIGINAL_ORIGIN_HEADER}" header, so it can not be proxied upstream.`,
    {
      hint: `Mock it with app.network.use(http.${method.toLowerCase()}('${path.split('?')[0]}', ...)), or make the app send "${ORIGINAL_ORIGIN_HEADER}: <real API origin>" on requests it routes to mockUrl.`,
      docs: DOCS.integration,
    },
  );
}

export function badOriginError(value: string): DpadError {
  return new DpadError(
    MockErrorCode.BAD_ORIGIN,
    `Invalid "${ORIGINAL_ORIGIN_HEADER}" header "${value}": expected an http(s) origin such as https://api.example.com.`,
    {
      hint: 'Send only scheme, host and port in the header and keep the path in the request URL: GET <mockUrl>/v2/items with the header https://api.example.com.',
      docs: DOCS.integration,
    },
  );
}

export function badRequestError(method: string, path: string, cause: unknown): DpadError {
  return new DpadError(
    MockErrorCode.BAD_REQUEST,
    `${method} ${path} can not be handled by the mock server: ${messageOf(cause)}`,
    {
      hint: 'The mock server handles standard HTTP requests (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, ...). CONNECT, TRACE and protocol upgrades are not supported.',
      docs: DOCS.concepts,
      cause,
    },
  );
}

export function unhandledError(method: string, url: string): DpadError {
  return new DpadError(
    MockErrorCode.UNHANDLED,
    `${method} ${url} matched no mock handler and unhandled requests are rejected (onUnhandledRequest: 'reject').`,
    {
      hint: `Add a handler for it with app.network.use(http.${method.toLowerCase()}(...)), or allow proxying with onUnhandledRequest: 'proxy'.`,
      docs: DOCS.handlers,
    },
  );
}

export function upstreamError(method: string, url: string, cause: unknown): DpadError {
  return new DpadError(
    MockErrorCode.UPSTREAM_UNREACHABLE,
    `Proxying ${method} ${url} upstream failed: ${messageOf(cause)}`,
    {
      hint: 'No handler matched, so the request went to the real API, which is unreachable from the test host. Check network/VPN access to that host, or mock the request with app.network.use(...).',
      docs: DOCS.concepts,
      cause,
    },
  );
}

export function handlerError(method: string, url: string, cause: unknown): DpadError {
  return new DpadError(
    MockErrorCode.HANDLER_ERROR,
    `The mock handler for ${method} ${url} threw: ${messageOf(cause)}`,
    {
      hint: 'Fix the handler. To simulate a server error return HttpResponse.json(body, { status: 500 }); to simulate a dropped connection return HttpResponse.error() or use failure().',
      docs: DOCS.handlers,
      cause,
    },
  );
}

export function invalidHandlerError(value: unknown): DpadError {
  return new DpadError(
    MockErrorCode.INVALID_HANDLER,
    `Expected an MSW request handler, got ${describe(value)}.`,
    {
      hint: "Pass handlers created with http.get(...), http.post(...), latency(...) or failure(...) from '@dpad-tv/mock'. WebSocket handlers (ws.link) are not supported.",
      docs: DOCS.handlers,
    },
  );
}

export function invalidOptionError(name: string, value: unknown, expected: string): DpadError {
  return new DpadError(
    MockErrorCode.INVALID_OPTION,
    `Invalid ${name}: ${JSON.stringify(value) ?? String(value)}. Expected ${expected}.`,
    { hint: `Fix the "${name}" value passed to @dpad-tv/mock.`, docs: DOCS.handlers },
  );
}

export function portInUseError(port: number, cause: unknown): DpadError {
  return new DpadError(MockErrorCode.PORT_IN_USE, `Mock server port ${port} is already in use.`, {
    hint: 'Omit the port to let the OS pick a free one (recommended: one mock server per worker), or free the port.',
    docs: DOCS.concepts,
    cause,
  });
}

export function listenError(cause: unknown): DpadError {
  return new DpadError(
    MockErrorCode.LISTEN_FAILED,
    `Mock server failed to start: ${messageOf(cause)}`,
    {
      hint: 'The server listens on the loopback interface (127.0.0.1 and ::1). Check that the process may open local ports.',
      docs: DOCS.concepts,
      cause,
    },
  );
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && !error.message.includes(code)
      ? `${code} ${error.message}`
      : error.message;
  }
  return String(error);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'function') {
    return 'a function (did you pass a resolver instead of http.get(path, resolver)?)';
  }
  if (typeof value === 'object') {
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind === 'string') return `a handler of kind "${kind}"`;
    return 'an object';
  }
  return typeof value;
}
