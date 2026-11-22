import type { RecordedRequest } from './api.js';

/** Request filter shared by `app.network.requests()` and `toHaveRequested()`. */
export interface RequestFilter {
  readonly method?: string;
  /** A string matches by the mock server's URL rules; a RegExp is tested against the full URL. */
  readonly url?: string | RegExp;
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
  close(): Promise<void>;
}
