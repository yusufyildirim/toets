import { getGlobal } from '../env.js';
import type { IdleTracker } from '../idle.js';

const MAX_URL = 160;

/** `GET /api/home` style description; same-origin URLs lose their origin. */
export function describeRequest(method: unknown, url: unknown): string {
  let u = String(url === undefined || url === null ? '' : url);
  const loc = getGlobal().location as { origin?: string } | undefined;
  if (
    loc &&
    typeof loc.origin === 'string' &&
    loc.origin !== 'null' &&
    u.indexOf(loc.origin) === 0
  ) {
    u = u.slice(loc.origin.length) || '/';
  }
  if (u.length > MAX_URL) u = `${u.slice(0, MAX_URL)}...`;
  return `${String(method || 'GET').toUpperCase()} ${u}`;
}

/** Tracks `fetch` calls until their promise settles. */
export function instrumentFetch(tracker: IdleTracker): () => void {
  const g = getGlobal();
  const orig = g.fetch as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof orig !== 'function') return () => {};
  let enabled = true;

  function fetchTracked(this: unknown, ...args: unknown[]): Promise<unknown> {
    if (!enabled || tracker.isUntracked) return orig!.apply(g, args);
    const input = args[0] as { url?: unknown; method?: unknown } | string | undefined;
    const init = args[1] as { method?: unknown } | undefined;
    const isObj = typeof input === 'object' && input !== null;
    const method = (init && init.method) || (isObj ? input.method : undefined) || 'GET';
    const url = isObj && typeof input.url === 'string' ? input.url : input;
    const release = tracker.begin('network', describeRequest(method, url));
    let result: Promise<unknown>;
    try {
      result = orig!.apply(g, args);
    } catch (error) {
      release();
      throw error;
    }
    if (result && typeof result.then === 'function') result.then(release, release);
    else release();
    return result;
  }

  g.fetch = fetchTracked;
  return () => {
    enabled = false;
    if (g.fetch === fetchTracked) g.fetch = orig;
  };
}

interface XhrLike {
  addEventListener(type: string, listener: () => void): void;
  readyState: number;
}

/** Tracks `XMLHttpRequest`s from `send()` until `loadend` (or an equivalent terminal event). */
export function instrumentXhr(tracker: IdleTracker): () => void {
  const g = getGlobal();
  const Xhr = g.XMLHttpRequest as { prototype: Record<string, unknown> } | undefined;
  if (!Xhr || !Xhr.prototype) return () => {};
  const proto = Xhr.prototype;
  const origOpen = proto.open as (...args: unknown[]) => unknown;
  const origSend = proto.send as (...args: unknown[]) => unknown;
  if (typeof origOpen !== 'function' || typeof origSend !== 'function') return () => {};
  const info = new WeakMap<object, string>();
  let enabled = true;

  function openTracked(this: object, ...args: unknown[]): unknown {
    info.set(this, describeRequest(args[0], args[1]));
    return origOpen.apply(this, args);
  }

  function sendTracked(this: XhrLike, ...args: unknown[]): unknown {
    const description = info.get(this);
    if (!enabled || tracker.isUntracked || description === undefined)
      return origSend.apply(this, args);
    const release = tracker.begin('network', description);
    const done = (): void => release();
    for (const type of ['loadend', 'abort', 'error', 'timeout', 'load'])
      this.addEventListener(type, done);
    this.addEventListener('readystatechange', () => {
      if (this.readyState === 4) release();
    });
    try {
      return origSend.apply(this, args);
    } catch (error) {
      release();
      throw error;
    }
  }

  proto.open = openTracked;
  proto.send = sendTracked;
  return () => {
    enabled = false;
    if (proto.open === openTracked) proto.open = origOpen;
    if (proto.send === sendTracked) proto.send = origSend;
  };
}
