import { HttpHandler, HttpResponse, type Path } from 'msw';
import { invalidOptionError } from './errors.js';

/** Which requests a {@link latency} or {@link failure} handler applies to. */
export interface RequestMatch {
  /** HTTP method, case-insensitive. Default: every method. */
  readonly method?: string;
  /** MSW path (`'/v1/items'`, `'https://api.example.com/*'`, RegExp). Default `'*'`: all URLs. */
  readonly url?: Path;
}

/** Fixed delay in ms, a uniformly random range, or `'infinite'` (the request never completes). */
export type LatencySpec = number | { readonly min: number; readonly max: number } | 'infinite';

/**
 * A handler that delays matching requests, then lets them continue to the next handler or
 * upstream. It changes no responses, so it composes with mocks and with proxied traffic.
 *
 * Handler order matters: it only delays requests that reach it, so put it before the handlers
 * it should slow down (first in the same `use()` call, or in a later `use()` call).
 *
 * @example
 * app.network.use(latency(2000, { url: '/v1/rails' }));
 * app.network.use(latency({ min: 100, max: 400 })); // every request
 */
export function latency(spec: LatencySpec, match: RequestMatch = {}): HttpHandler {
  const pick = compileLatency(spec);
  return handlerFor(match, async ({ request }) => {
    await sleep(pick(), request.signal);
    return undefined;
  });
}

/** Options for {@link failure}. */
export interface FailureOptions extends RequestMatch {
  /** HTTP status (400-599) to answer with. Omit to drop the connection (a network error). */
  readonly status?: number;
  /** Fail only the first `times` matching requests, then let them through. Default: always. */
  readonly times?: number;
}

/**
 * A handler that makes matching requests fail: with an empty `status` response, or by
 * dropping the connection when no status is given. Use it to test error and retry UI.
 *
 * @example
 * app.network.use(failure({ url: '/v1/rails', status: 503, times: 1 })); // first call fails
 * app.network.use(failure({ url: '/v1/me' })); // network error
 */
export function failure(opts: FailureOptions = {}): HttpHandler {
  const { status, times } = opts;
  if (status !== undefined && (!Number.isInteger(status) || status < 400 || status > 599)) {
    throw invalidOptionError('failure status', status, 'an HTTP error status between 400 and 599');
  }
  if (times !== undefined && (!Number.isInteger(times) || times < 1)) {
    throw invalidOptionError('failure times', times, 'a positive integer');
  }
  let remaining = times ?? Number.POSITIVE_INFINITY;
  return handlerFor(opts, () => {
    if (remaining <= 0) return undefined;
    remaining--;
    return status === undefined ? HttpResponse.error() : new HttpResponse(null, { status });
  });
}

type Resolver = ConstructorParameters<typeof HttpHandler>[2];

function handlerFor(match: RequestMatch, resolver: Resolver): HttpHandler {
  return new HttpHandler(match.method?.toUpperCase() ?? /.+/, match.url ?? '*', resolver);
}

const MAX_TIMEOUT = 2_147_483_647;

function compileLatency(spec: LatencySpec): () => number {
  if (spec === 'infinite') return () => Number.POSITIVE_INFINITY;
  if (typeof spec === 'number') {
    assertDelay('latency', spec);
    return () => spec;
  }
  const { min, max } = spec;
  assertDelay('latency min', min);
  assertDelay('latency max', max);
  if (max < min) throw invalidOptionError('latency range', spec, 'min <= max');
  return () => min + Math.random() * (max - min);
}

function assertDelay(name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_TIMEOUT) {
    throw invalidOptionError(name, ms, `a duration in ms between 0 and ${MAX_TIMEOUT}`);
  }
}

/** Resolves after `ms` or as soon as `signal` aborts (the app gave up, or the server closed). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = Number.isFinite(ms) ? setTimeout(done, ms) : undefined;
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
