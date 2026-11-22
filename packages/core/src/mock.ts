import type { RecordedRequest } from './api.js';

/** Request filter shared by `app.network.requests()` and `toHaveRequested()`. */
export interface RequestFilter {
  readonly method?: string;
  /** A string matches by the mock server's URL rules; a RegExp is tested against the full URL. */
  readonly url?: string | RegExp;
}

/**
 * Mock server settings of the `mock` runtime option, handed to the server factory. Handlers are
 * opaque to the core: `@dpad-tv/mock` takes MSW request handlers.
 */
export interface MockServerConfig {
  /** Port to listen on. Default: a free port. */
  readonly port?: number;
  /**
   * Baseline handlers, active in every test. Handlers a test adds with `app.network.use()` are
   * removed after it; these stay.
   */
  readonly handlers?: readonly unknown[];
  /**
   * A request no handler answers: `proxy` (default) forwards it to the real origin, `reject`
   * fails it (`MOCK_UNHANDLED`), which keeps a suite hermetic.
   */
  readonly onUnhandledRequest?: 'proxy' | 'reject';
  /** Max bytes recorded per request or response body (bodies are always forwarded in full). */
  readonly maxRecordedBodyBytes?: number;
}

/**
 * What the core needs from the host-side mock server. `@dpad-tv/mock`'s `MockServer`
 * satisfies it; the core never imports that package so the dependency stays optional.
 */
export interface MockServerLike {
  /** Base URL handed to the app in the launch payload (`localhost`, see the protocol docs). */
  readonly url: string;
  use(...handlers: readonly unknown[]): void;
  resetHandlers(): void;
  requests(filter?: RequestFilter): readonly RecordedRequest[];
  clearRequests(): void;
  /** Recorded traffic as a HAR 1.2 log, attached to each test's report. */
  toHar?(): unknown;
  close(): Promise<void>;
}
