import type { BusyResource } from '@dpad-tv/protocol';
import { now, setNativeTimeout } from './env.js';

/** Matches busy resources to ignore: substring of the description, RegExp, or predicate. */
export type IdleIgnoreRule = string | RegExp | ((resource: BusyResource) => boolean);

export interface IdleOptions {
  /**
   * Quiet time required before reporting idle when the host does not specify one. Default 100.
   */
  readonly quietMs?: number;
  /** `setTimeout` calls shorter than this are tracked. `0` disables timer tracking. Default 1500. */
  readonly timerThresholdMs?: number;
  /** Track `fetch`. Default true. */
  readonly fetch?: boolean;
  /** Track `XMLHttpRequest`. Default true. */
  readonly xhr?: boolean;
  /**
   * Busy resources to ignore: polling endpoints, analytics beacons, carousels. Strings match
   * as substrings of the description (`GET https://example.com/poll`), RegExps test it.
   */
  readonly ignore?: readonly IdleIgnoreRule[];
}

/** Returns what an external source is busy with right now (e.g. running CSS animations). */
export type BusyProbe = () => readonly BusyResource[];

interface Entry {
  readonly kind: string;
  readonly description: string;
  readonly since: number;
}

export interface IdleResult {
  readonly idle: boolean;
  readonly busy: readonly BusyResource[];
}

const TICK_MS = 16;
const RECENT_MS = 2000;
const RECENT_LIMIT = 20;

/**
 * Tracks work the app is doing. Idle = nothing tracked for a quiet window (decision 16).
 * Idle is an accelerator for the host, never a gate: when the app never settles the host
 * falls back to polling and reports the busy resources named here.
 */
export class IdleTracker {
  private readonly entries = new Map<number, Entry>();
  private readonly probes: BusyProbe[] = [];
  private readonly recent: Array<BusyResource & { readonly at: number }> = [];
  private readonly ignoreRules: IdleIgnoreRule[];
  private nextId = 1;
  private lastChange = 0;
  private untrackedDepth = 0;
  readonly quietMs: number;

  constructor(options: Pick<IdleOptions, 'quietMs' | 'ignore'> = {}) {
    this.quietMs = options.quietMs ?? 100;
    this.ignoreRules = (options.ignore ?? []).slice();
  }

  /**
   * Marks the app busy until the returned function is called (idempotent).
   * `maxMs` releases automatically, as a safety net against leaks.
   */
  begin(kind: string, description: string, maxMs?: number): () => void {
    if (this.isIgnored({ kind, description })) return noop;
    const id = this.nextId++;
    const entry: Entry = { kind, description, since: now() };
    this.entries.set(id, entry);
    this.lastChange = entry.since;
    let done = false;
    const release = (): void => {
      if (done) return;
      done = true;
      if (!this.entries.delete(id)) return;
      const at = now();
      this.lastChange = at;
      this.remember({ kind, description, durationMs: at - entry.since }, at);
    };
    if (maxMs !== undefined) setNativeTimeout(release, maxMs);
    return release;
  }

  /** Registers a probe polled while waiting for idle. Returns an unregister function. */
  addProbe(probe: BusyProbe): () => void {
    this.probes.push(probe);
    return () => {
      const i = this.probes.indexOf(probe);
      if (i >= 0) this.probes.splice(i, 1);
    };
  }

  /** Adds an ignore rule at runtime. */
  ignore(rule: IdleIgnoreRule): void {
    this.ignoreRules.push(rule);
  }

  isIgnored(resource: BusyResource): boolean {
    for (const rule of this.ignoreRules) {
      if (
        typeof rule === 'string'
          ? resource.description.indexOf(rule) >= 0
          : rule instanceof RegExp
            ? rule.test(resource.description)
            : safe(() => rule(resource), false)
      )
        return true;
    }
    return false;
  }

  /**
   * Runs `fn` with tracking disabled: timers it schedules (and their callbacks, recursively)
   * and requests it starts are not tracked. Use for polling loops, carousels, playback clocks.
   */
  untracked<T>(fn: () => T): T {
    this.untrackedDepth++;
    try {
      return fn();
    } finally {
      this.untrackedDepth--;
    }
  }

  get isUntracked(): boolean {
    return this.untrackedDepth > 0;
  }

  /** What the app is busy with right now. */
  busy(): BusyResource[] {
    const t = now();
    const out: BusyResource[] = [];
    this.entries.forEach((e) =>
      out.push({ kind: e.kind, description: e.description, durationMs: t - e.since }),
    );
    for (const probe of this.probes.slice()) {
      for (const r of safe(probe, [] as readonly BusyResource[])) {
        if (!this.isIgnored(r)) out.push(r);
      }
    }
    return out;
  }

  /**
   * Resolves `{ idle: true }` once nothing was busy for `quietMs`, or `{ idle: false, busy }`
   * at `timeoutMs`. With `timeoutMs` 0 it answers from the current state immediately.
   */
  waitForIdle(timeoutMs: number, quietMs: number = this.quietMs): Promise<IdleResult> {
    const start = now();
    let lastBusy: BusyResource[] = [];
    let quietSince: number | null = null;
    return new Promise((resolve) => {
      const check = (): void => {
        const t = now();
        const busy = this.busy();
        if (busy.length > 0) {
          lastBusy = busy;
          quietSince = null;
          this.lastChange = t;
          for (const r of busy) if (r.durationMs === undefined) this.remember(r, t);
        } else if (quietSince === null) {
          quietSince = t;
        }
        if (quietSince !== null && t - this.lastChange >= quietMs) {
          resolve({ idle: true, busy: [] });
          return;
        }
        if (t - start >= timeoutMs) {
          resolve({ idle: false, busy: busy.length > 0 ? busy : this.recentBusy(t, lastBusy) });
          return;
        }
        setNativeTimeout(check, Math.min(TICK_MS, Math.max(0, timeoutMs - (t - start))));
      };
      check();
    });
  }

  private remember(r: BusyResource, at: number): void {
    this.recent.push({ ...r, at });
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
  }

  /** Resources that were busy recently, for reports when the app churns between short tasks. */
  private recentBusy(t: number, lastBusy: BusyResource[]): BusyResource[] {
    const seen: Record<string, true> = {};
    const out: BusyResource[] = [];
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const r = this.recent[i] as BusyResource & { at: number };
      const key = `${r.kind}\n${r.description}`;
      if (t - r.at > RECENT_MS || seen[key]) continue;
      seen[key] = true;
      out.push({ kind: r.kind, description: `${r.description} (recently)` });
    }
    if (out.length === 0 && lastBusy.length > 0) return lastBusy;
    if (out.length === 0)
      out.push({ kind: 'settling', description: 'activity within the quiet window' });
    return out;
  }
}

function noop(): void {}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
