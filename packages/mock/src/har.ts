import pkg from '../package.json' with { type: 'json' };
import type { Exchange } from './record.js';

/** A HAR 1.2 log (http://www.softwareishard.com/blog/har-12-spec/). */
export interface Har {
  readonly log: HarLog;
}

export interface HarLog {
  readonly version: '1.2';
  readonly creator: { readonly name: string; readonly version: string };
  readonly entries: readonly HarEntry[];
}

export interface HarNameValue {
  readonly name: string;
  readonly value: string;
}

export interface HarEntry {
  readonly startedDateTime: string;
  /** Total time in ms (elapsed so far for in-flight requests). */
  readonly time: number;
  readonly request: HarRequest;
  readonly response: HarResponse;
  readonly cache: Record<string, never>;
  readonly timings: HarTimings;
  /** dpad extension: record id, whether a handler answered, failure reason. */
  readonly _dpad: {
    readonly id: string;
    readonly mocked: boolean;
    readonly inFlight: boolean;
    readonly error: { readonly code: string; readonly message: string } | null;
  };
}

export interface HarRequest {
  readonly method: string;
  readonly url: string;
  readonly httpVersion: string;
  readonly cookies: readonly HarNameValue[];
  readonly headers: readonly HarNameValue[];
  readonly queryString: readonly HarNameValue[];
  readonly postData?: {
    readonly mimeType: string;
    readonly text: string;
    /** Non-standard but widely read: `base64` for binary bodies. */
    readonly encoding?: 'base64';
    readonly comment?: string;
  };
  readonly headersSize: -1;
  readonly bodySize: number;
}

export interface HarResponse {
  /** `0` when no response was sent (dropped connection, aborted, in flight). */
  readonly status: number;
  readonly statusText: string;
  readonly httpVersion: string;
  readonly cookies: readonly HarNameValue[];
  readonly headers: readonly HarNameValue[];
  readonly content: {
    readonly size: number;
    readonly compression?: number;
    readonly mimeType: string;
    readonly text?: string;
    readonly encoding?: 'base64';
    readonly comment?: string;
  };
  readonly redirectURL: string;
  readonly headersSize: -1;
  readonly bodySize: number;
  readonly _error?: string;
}

export interface HarTimings {
  readonly blocked: -1;
  readonly dns: -1;
  readonly connect: -1;
  readonly ssl: -1;
  readonly send: number;
  readonly wait: number;
  readonly receive: number;
}

export function toHar(exchanges: readonly Exchange[]): Har {
  return {
    log: {
      version: '1.2',
      creator: { name: pkg.name, version: pkg.version },
      entries: exchanges.map(toEntry),
    },
  };
}

function toEntry(e: Exchange): HarEntry {
  const time = e.durationMs ?? e.elapsed();
  const wait = Math.min(e.headersMs ?? time, time);
  return {
    startedDateTime: new Date(e.timestamp).toISOString(),
    time,
    request: toRequest(e),
    response: toResponse(e),
    cache: {},
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      ssl: -1,
      send: 0,
      wait,
      receive: Math.max(0, time - wait),
    },
    _dpad: { id: e.id, mocked: e.mocked, inFlight: !e.done, error: e.error },
  };
}

function toRequest(e: Exchange): HarRequest {
  const url = new URL(e.url);
  const body = e.requestBodyText();
  const headers = Object.entries(e.headers).map(([name, value]) => ({ name, value }));
  return {
    method: e.method,
    url: e.url,
    httpVersion: `HTTP/${e.httpVersion}`,
    cookies: parseCookieHeader(e.headers['cookie']),
    headers,
    queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
    ...(body.text !== null && {
      postData: {
        mimeType: e.headers['content-type'] ?? 'application/octet-stream',
        text: body.text,
        ...(body.encoding === 'base64' && { encoding: 'base64' as const }),
        ...(e.requestBody.truncated && {
          comment: `Truncated to the first ${body.text.length} recorded characters.`,
        }),
      },
    }),
    headersSize: -1,
    bodySize: e.requestBody.size,
  };
}

function toResponse(e: Exchange): HarResponse {
  if (e.status === null || !e.responseHeaders) {
    return {
      status: 0,
      statusText: '',
      httpVersion: '',
      cookies: [],
      headers: [],
      content: { size: 0, mimeType: 'x-unknown' },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
      ...(e.error ? { _error: `${e.error.code}: ${e.error.message}` } : !e.done && { _error: 'in flight' }),
    };
  }
  const headers = e.responseHeaders.map(([name, value]) => ({ name, value }));
  const find = (name: string) => e.responseHeaders?.find(([n]) => n === name)?.[1];
  const capture = e.responseBody;
  const bodySize = capture?.size ?? 0;
  const decoded = e.done ? e.responseBodyDecoded() : null;
  const size = decoded?.decodedSize ?? bodySize;
  return {
    status: e.status,
    statusText: e.statusText,
    httpVersion: 'HTTP/1.1',
    cookies: e.responseHeaders
      .filter(([name]) => name === 'set-cookie')
      .map(([, value]) => parseSetCookie(value)),
    headers,
    content: {
      size,
      ...(size !== bodySize && { compression: size - bodySize }),
      mimeType: find('content-type') ?? 'x-unknown',
      ...(decoded?.text != null && { text: decoded.text }),
      ...(decoded?.encoding === 'base64' && decoded.text != null && { encoding: 'base64' as const }),
      ...(capture?.truncated && { comment: 'Body truncated to maxRecordedBodyBytes (raw bytes).' }),
    },
    redirectURL: find('location') ?? '',
    headersSize: -1,
    bodySize,
    ...(e.error && { _error: `${e.error.code}: ${e.error.message}` }),
  };
}

function parseCookieHeader(value: string | undefined): HarNameValue[] {
  if (!value) return [];
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { name: part, value: '' }
        : { name: part.slice(0, eq), value: part.slice(eq + 1) };
    });
}

function parseSetCookie(value: string): HarNameValue {
  const pair = value.split(';', 1)[0] ?? '';
  const eq = pair.indexOf('=');
  return eq < 0
    ? { name: pair.trim(), value: '' }
    : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
}
