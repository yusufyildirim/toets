import type { RecordedRequest } from '@dpad-tv/core';
import { matchRequestUrl } from 'msw';
import {
  BodyCapture,
  decodeBody,
  encodeBytes,
  type BodyEncoding,
  type DecodedBody,
} from './body.js';

/** Why a recorded request failed. `code` is one of {@link MockErrorCode}. */
export interface RecordedMockError {
  readonly code: string;
  readonly message: string;
}

/** The response the app received, as recorded by the mock server. */
export interface RecordedMockResponse {
  readonly status: number;
  readonly statusText: string;
  /** Headers as sent to the app (lowercase names, repeated values joined with `, `). */
  readonly headers: Readonly<Record<string, string>>;
  /** Body with `content-encoding` removed; `null` when empty. See `bodyEncoding`. */
  readonly body: string | null;
  readonly bodyEncoding: BodyEncoding;
  /** Bytes sent to the app (before decoding). */
  readonly bodySize: number;
  /** True when the body exceeded `maxRecordedBodyBytes`; `body` is then a raw prefix. */
  readonly bodyTruncated: boolean;
}

/**
 * A request seen by the mock server. Extends the core {@link RecordedRequest} contract with an
 * id, body details, timing, failure reason and the response.
 *
 * - `url` is the URL the app meant to call: the original origin (from the origin header) plus
 *   the request path, e.g. `https://api.example.com/v1/items?page=2`. Without the header the
 *   mock server's own origin is used.
 * - `headers` are the request headers exactly as the app sent them (lowercase names).
 * - `body` is UTF-8 text when the bytes are valid UTF-8, otherwise base64 (`bodyEncoding`).
 * - `status` is `null` while in flight and when no response was sent (dropped connection).
 */
export interface RecordedMockRequest extends RecordedRequest {
  /** Unique per server and sent to the app as the `x-dpad-request-id` response header. */
  readonly id: string;
  readonly bodyEncoding: BodyEncoding;
  /** Request body size in bytes. */
  readonly bodySize: number;
  /** True when the body exceeded `maxRecordedBodyBytes`; `body` is then a prefix. */
  readonly bodyTruncated: boolean;
  /** `null` while in flight, else the time from request start to the end of the response. */
  readonly durationMs: number | null;
  /** Set when the request failed: no route, upstream unreachable, handler threw, ... */
  readonly error: RecordedMockError | null;
  /** `null` until response headers are sent, and when the connection was dropped. */
  readonly response: RecordedMockResponse | null;
}

/** Filter for {@link MockServer.requests} and {@link MockServer.toHar}. */
export interface RequestFilter {
  /** HTTP method, case-insensitive. */
  readonly method?: string;
  /**
   * A string uses MSW path matching, the same rules as `http.get(path)`: `:params`, `*`
   * wildcards, query string ignored, relative paths (`/v1/items`) match any origin. A RegExp
   * is tested against the full URL including the query string.
   */
  readonly url?: string | RegExp;
}

/** Mutable internal state of one exchange; exposed only through immutable snapshots. */
export class Exchange {
  mocked = false;
  /** True once a response body started streaming. */
  streaming = false;
  error: RecordedMockError | null = null;
  status: number | null = null;
  statusText = '';
  /** Response headers in wire order, repeated names kept. */
  responseHeaders: Array<[string, string]> | null = null;
  responseBody: BodyCapture | null = null;
  /** Milliseconds from start until response headers were sent. */
  headersMs: number | null = null;
  durationMs: number | null = null;
  private readonly started = performance.now();
  private cache: RecordedMockRequest | null = null;
  private requestText: { text: string | null; encoding: BodyEncoding } | null = null;
  private decoded: DecodedBody | null = null;

  constructor(
    readonly id: string,
    readonly method: string,
    readonly url: string,
    readonly headers: Readonly<Record<string, string>>,
    readonly timestamp: number,
    readonly requestBody: BodyCapture,
    readonly httpVersion: string,
    private readonly bodyLimit: number,
  ) {}

  elapsed(): number {
    return Math.round((performance.now() - this.started) * 1000) / 1000;
  }

  responseStarted(status: number, statusText: string, headers: Array<[string, string]>): void {
    this.status = status;
    this.statusText = statusText;
    this.responseHeaders = headers;
    this.headersMs = this.elapsed();
    this.cache = null;
  }

  finish(error: RecordedMockError | null = null): void {
    if (this.durationMs !== null) return;
    this.durationMs = this.elapsed();
    if (error) this.error = error;
    this.cache = null;
  }

  get done(): boolean {
    return this.durationMs !== null;
  }

  requestBodyText(): { text: string | null; encoding: BodyEncoding } {
    this.requestText ??= encodeBytes(this.requestBody.bytes());
    return this.requestText;
  }

  /** Decoded response body; only meaningful once {@link done}. Memoized. */
  responseBodyDecoded(): DecodedBody {
    if (this.decoded) return this.decoded;
    const capture = this.responseBody ?? new BodyCapture(0);
    const encoding = this.responseHeaders?.find(([n]) => n === 'content-encoding')?.[1] ?? null;
    const decoded = decodeBody(capture, encoding, this.bodyLimit);
    if (this.done) this.decoded = decoded;
    return decoded;
  }

  /** Immutable view. Cached once the exchange completed so repeated polling stays cheap. */
  snapshot(): RecordedMockRequest {
    if (this.cache) return this.cache;
    const body = this.requestBodyText();
    const snap: RecordedMockRequest = Object.freeze({
      id: this.id,
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: body.text,
      bodyEncoding: body.encoding,
      bodySize: this.requestBody.size,
      bodyTruncated: this.requestBody.truncated,
      timestamp: this.timestamp,
      mocked: this.mocked,
      status: this.status,
      durationMs: this.durationMs,
      error: this.error,
      response: this.responseSnapshot(),
    });
    if (this.done) this.cache = snap;
    return snap;
  }

  private responseSnapshot(): RecordedMockResponse | null {
    if (this.status === null || !this.responseHeaders) return null;
    const headers = joinHeaders(this.responseHeaders);
    const capture = this.responseBody ?? new BodyCapture(0);
    const decoded = this.done
      ? this.responseBodyDecoded()
      : { text: null, encoding: 'utf8' as const };
    return Object.freeze({
      status: this.status,
      statusText: this.statusText,
      headers,
      body: decoded.text,
      bodyEncoding: decoded.encoding,
      bodySize: capture.size,
      bodyTruncated: capture.truncated,
    });
  }
}

export function joinHeaders(pairs: Iterable<[string, string]>): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of pairs) {
    const key = name.toLowerCase();
    const prev = out[key];
    out[key] = prev === undefined ? value : `${prev}, ${value}`;
  }
  return Object.freeze(out);
}

/** Compiles a {@link RequestFilter} into a predicate over exchanges. */
export function compileFilter(filter: RequestFilter | undefined): (e: Exchange) => boolean {
  if (!filter) return () => true;
  const method = filter.method?.toUpperCase();
  const url = filter.url;
  let matchUrl: (e: Exchange) => boolean = () => true;
  if (url instanceof RegExp) {
    const re = new RegExp(url.source, url.flags.replace(/[gy]/g, ''));
    matchUrl = (e) => re.test(e.url);
  } else if (typeof url === 'string') {
    matchUrl = (e) => {
      const parsed = new URL(e.url);
      return matchRequestUrl(parsed, url, parsed.origin).matches;
    };
  }
  return (e) => (method === undefined || e.method === method) && matchUrl(e);
}
