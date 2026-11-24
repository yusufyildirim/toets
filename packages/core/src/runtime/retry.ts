import type { BusyResource } from '@toets/protocol';
import { ToetsError } from '../errors.js';

/** Result of one wait for app idle (`sync.idle`). */
export type IdleCheck =
  | { readonly supported: false }
  | { readonly supported: true; readonly idle: boolean; readonly busy: readonly BusyResource[] };

/** How idle sync went during a retried operation; shown in failure messages. */
export type IdleOutcome =
  /** No SDK sync available: plain polling. */
  | { readonly kind: 'unsupported' }
  /** The app reached idle before the last evaluation. */
  | { readonly kind: 'idle' }
  /** The app never became idle within the budget; polling took over. */
  | { readonly kind: 'busy'; readonly budgetMs: number; readonly busy: readonly BusyResource[] };

export interface RetryContext {
  waitForIdle(budgetMs: number): Promise<IdleCheck>;
}

export interface RetryOptions {
  readonly timeoutMs: number;
  /** Max time spent waiting for idle before falling back to polling. */
  readonly idleBudgetMs: number;
  /** Pause between evaluations; the last value repeats. */
  readonly intervals?: readonly number[];
}

export interface RetryResult<T> {
  readonly ok: boolean;
  /** Value of the last evaluation (`undefined` only if every evaluation threw). */
  readonly value: T | undefined;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly idle: IdleOutcome;
  /** Last non-toets error thrown by an evaluation, if the last attempt threw. */
  readonly error: unknown;
}

export const DEFAULT_INTERVALS: readonly number[] = [100, 250, 500, 1000];

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * The retry engine behind every assertion and wait (VISION decision 16: idle is an
 * accelerator, never a gate).
 *
 * Before each evaluation it waits for the app to be idle when the SDK offers `sync.idle`, so an
 * assertion observes the settled screen, which makes negative assertions meaningful and fast.
 * When the app is not idle within `idleBudgetMs`, it stops waiting for idle and polls until the
 * timeout, remembering which resources kept the app busy so failures can name them.
 *
 * `evaluate` errors: a `ToetsError` is a user-fixable problem and propagates at once; any other
 * error (a transient driver hiccup) is retried.
 */
export async function retry<T>(
  ctx: RetryContext,
  evaluate: () => Promise<{ readonly ok: boolean; readonly value: T }>,
  opts: RetryOptions,
): Promise<RetryResult<T>> {
  const intervals = opts.intervals ?? DEFAULT_INTERVALS;
  const start = performance.now();
  const deadline = start + opts.timeoutMs;
  let idle: IdleOutcome = { kind: 'unsupported' };
  let syncing = true;
  let attempts = 0;
  let value: T | undefined;
  let error: unknown;

  for (;;) {
    if (syncing) {
      const budget = Math.max(0, Math.min(deadline - performance.now(), opts.idleBudgetMs));
      const check = await ctx.waitForIdle(budget);
      if (!check.supported) {
        syncing = false;
      } else if (check.idle) {
        idle = { kind: 'idle' };
      } else {
        idle = { kind: 'busy', budgetMs: opts.idleBudgetMs, busy: check.busy };
        syncing = false;
      }
    }

    attempts++;
    try {
      const result = await evaluate();
      value = result.value;
      error = undefined;
      if (result.ok) {
        return { ok: true, value, attempts, elapsedMs: performance.now() - start, idle, error };
      }
    } catch (e) {
      if (e instanceof ToetsError) throw e;
      error = e;
    }

    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      return { ok: false, value, attempts, elapsedMs: performance.now() - start, idle, error };
    }
    const interval = intervals[Math.min(attempts - 1, intervals.length - 1)] ?? 1000;
    await sleep(Math.min(interval, remaining));
  }
}

/** One line describing idle sync, for failure messages. */
export function describeIdle(idle: IdleOutcome): string {
  switch (idle.kind) {
    case 'unsupported':
      return 'no SDK idle sync; polled';
    case 'idle':
      return 'app was idle when checked';
    case 'busy': {
      const busy = idle.busy.length
        ? idle.busy.map((b) => `${b.kind} ${b.description}`).join(', ')
        : 'unknown work';
      return `app never became idle within ${idle.budgetMs}ms (busy: ${busy}); polled instead`;
    }
  }
}
