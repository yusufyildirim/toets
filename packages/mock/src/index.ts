/**
 * toets network mocking: MSW handlers served by a host-side HTTP server. The app sends API
 * traffic to `mockUrl` (from the launch payload) with the real origin in a header; matched
 * requests get mocked responses, the rest is proxied upstream, and everything is recorded.
 *
 * Docs: `node_modules/@toets/mock/docs` (start with `concepts.md`).
 *
 * @packageDocumentation
 */
export {
  createMockServer,
  mockServerFactory,
  type MockServer,
  type MockServerOptions,
} from './server.js';
export {
  failure,
  latency,
  type FailureOptions,
  type LatencySpec,
  type RequestMatch,
} from './inject.js';
export type {
  RecordedMockError,
  RecordedMockRequest,
  RecordedMockResponse,
  RequestFilter,
} from './record.js';
export type { BodyEncoding } from './body.js';
export type {
  Har,
  HarEntry,
  HarLog,
  HarNameValue,
  HarRequest,
  HarResponse,
  HarTimings,
} from './har.js';
export { MockErrorCode } from './errors.js';
export { ERROR_HEADER, REQUEST_ID_HEADER } from './headers.js';
export { ORIGINAL_ORIGIN_HEADER } from '@toets/protocol';

/**
 * MSW building blocks, re-exported so handlers and the server share one MSW copy.
 * See https://mswjs.io/docs/api for `http`, `HttpResponse`, `delay`, `passthrough`, `bypass`.
 */
export { bypass, delay, http, HttpResponse, passthrough } from 'msw';
export type {
  DefaultBodyType,
  HttpHandler,
  HttpResponseResolver,
  JsonBodyType,
  Path,
  PathParams,
  RequestHandler,
} from 'msw';
