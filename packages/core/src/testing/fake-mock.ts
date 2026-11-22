import type { RecordedRequest } from '../api.js';
import type { MockServerLike, RequestFilter } from '../mock.js';
import { testRegExp } from '../runtime/tree.js';

/**
 * In-memory stand-in for `@dpad-tv/mock`'s server. Tests record requests with
 * {@link FakeMockServer.record}; handlers are stored, not executed.
 */
export class FakeMockServer implements MockServerLike {
  readonly url = 'http://localhost:9400';
  handlers: unknown[] = [];
  recorded: RecordedRequest[] = [];
  closed = false;

  use(...handlers: readonly unknown[]): void {
    this.handlers.unshift(...handlers);
  }

  resetHandlers(): void {
    this.handlers = [];
  }

  /** Records a request as if the app had sent it. */
  record(req: Partial<RecordedRequest> & { url: string }): void {
    this.recorded.push({
      method: 'GET',
      headers: {},
      body: null,
      timestamp: Date.now(),
      mocked: true,
      status: 200,
      ...req,
    });
  }

  requests(filter: RequestFilter = {}): readonly RecordedRequest[] {
    return this.recorded.filter((r) => {
      if (filter.method && r.method.toUpperCase() !== filter.method.toUpperCase()) return false;
      if (filter.url instanceof RegExp) return testRegExp(filter.url, r.url);
      if (typeof filter.url === 'string') return r.url.includes(filter.url);
      return true;
    });
  }

  clearRequests(): void {
    this.recorded = [];
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
