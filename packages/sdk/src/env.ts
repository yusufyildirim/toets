/**
 * Runtime environment helpers. The SDK runs in browsers (including old TV engines), Hermes
 * and Node, so it avoids `globalThis` and post-ES2015 built-ins.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGlobal = Record<string, any>;

export function getGlobal(): AnyGlobal {
  if (typeof globalThis !== 'undefined') return globalThis as unknown as AnyGlobal;
  if (typeof self !== 'undefined') return self as unknown as AnyGlobal;
  if (typeof window !== 'undefined') return window as unknown as AnyGlobal;
  return Function('return this')() as AnyGlobal;
}

const g = getGlobal();

/**
 * Timer functions captured before any instrumentation, used for the SDK's own scheduling so
 * idle tracking never sees them.
 */
export const native = {
  setTimeout: g.setTimeout as (fn: () => void, ms?: number) => unknown,
  clearTimeout: g.clearTimeout as (handle: unknown) => void,
  setInterval: g.setInterval as (fn: () => void, ms?: number) => unknown,
  clearInterval: g.clearInterval as (handle: unknown) => void,
  console: g.console as Console | undefined,
};

/** `setTimeout` that idle tracking never sees. For adapters' own scheduling. */
export function setNativeTimeout(fn: () => void, ms: number): unknown {
  return native.setTimeout.call(g, fn, ms);
}

/** Clears a {@link setNativeTimeout} handle. */
export function clearNativeTimeout(handle: unknown): void {
  native.clearTimeout.call(g, handle);
}

export const peerTimers = {
  setTimeout: (fn: () => void, ms: number): unknown => setNativeTimeout(fn, ms),
  clearTimeout: (handle: unknown): void => clearNativeTimeout(handle),
};

export function now(): number {
  return Date.now();
}

/** Writes to the console without being forwarded as an app log. */
export function sdkWarn(message: string): void {
  const c = native.console;
  if (c && typeof c.warn === 'function') {
    sdkLogDepth++;
    try {
      c.warn(`[toets] ${message}`);
    } finally {
      sdkLogDepth--;
    }
  }
}

/** > 0 while the SDK itself writes to the console (the console tap skips those lines). */
export let sdkLogDepth = 0;
