import { getGlobal } from '../env.js';
import type { IdleTracker } from '../idle.js';

/**
 * Tracks `setTimeout` calls shorter than `thresholdMs` until they fire or are cleared.
 * `setInterval` and `requestAnimationFrame` are never tracked: they drive polling, carousels
 * and playback clocks, which would keep the app busy forever.
 */
export function instrumentTimers(tracker: IdleTracker, thresholdMs: number): () => void {
  const g = getGlobal();
  const origSet = g.setTimeout as (...args: unknown[]) => unknown;
  const origClear = g.clearTimeout as (handle: unknown) => void;
  if (typeof origSet !== 'function' || thresholdMs <= 0) return () => {};
  const pending = new Map<unknown, () => void>();
  let enabled = true;

  function setTimeoutTracked(this: unknown, callback: unknown, ms?: unknown, ...rest: unknown[]): unknown {
    if (!enabled || typeof callback !== 'function') return origSet.call(g, callback, ms, ...rest);
    const fn = callback as (...a: unknown[]) => unknown;
    if (tracker.isUntracked) {
      // Keep the whole chain (a callback rescheduling itself) untracked.
      return origSet.call(g, function (this: unknown, ...a: unknown[]) {
        return tracker.untracked(() => fn.apply(this, a));
      }, ms, ...rest);
    }
    const delay = Number(ms) || 0;
    if (delay >= thresholdMs) return origSet.call(g, callback, ms, ...rest);
    const release = tracker.begin('timer', `setTimeout ${delay}ms`);
    let handle: unknown;
    handle = origSet.call(g, function (this: unknown, ...a: unknown[]) {
      pending.delete(key(handle));
      try {
        return fn.apply(this, a);
      } finally {
        release();
      }
    }, ms, ...rest);
    pending.set(key(handle), release);
    return handle;
  }

  function clearTimeoutTracked(handle: unknown): void {
    const k = key(handle);
    const release = pending.get(k);
    if (release) {
      pending.delete(k);
      release();
    }
    origClear.call(g, handle);
  }

  g.setTimeout = setTimeoutTracked;
  g.clearTimeout = clearTimeoutTracked;
  return () => {
    enabled = false;
    pending.forEach((release) => release());
    pending.clear();
    if (g.setTimeout === setTimeoutTracked) g.setTimeout = origSet;
    if (g.clearTimeout === clearTimeoutTracked) g.clearTimeout = origClear;
  };
}

// Node returns Timeout objects whose primitive value is the id; browsers and Hermes return numbers.
function key(handle: unknown): unknown {
  if (handle !== null && typeof handle === 'object') {
    const prim = (handle as { [Symbol.toPrimitive]?: () => unknown })[Symbol.toPrimitive];
    if (typeof prim === 'function') return prim.call(handle);
  }
  return handle;
}
