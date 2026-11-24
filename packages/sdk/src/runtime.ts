import {
  decodeLaunchPayload,
  HELLO_METHOD,
  METHOD_DOMAIN,
  NOTIFICATION_DOMAIN,
  PROTOCOL_VERSION,
  RpcError,
  RpcErrorCode,
  RpcPeer,
  type AppToHostNotifications,
  type Domain,
  type HelloResult,
  type HostToAppMethod,
  type HostToAppRequests,
  type LaunchFlags,
  type LaunchPayload,
  type LogEntryParams,
  type LogLevel,
} from '@toets/protocol';
import pkg from '../package.json' with { type: 'json' };
import { getGlobal, now, peerTimers, sdkWarn, setNativeTimeout } from './env.js';
import { IdleTracker, type IdleOptions } from './idle.js';
import { instrumentConsole } from './instrument/console.js';
import { instrumentFetch, instrumentXhr } from './instrument/network.js';
import { instrumentTimers } from './instrument/timers.js';
import { MediaRegistry } from './media.js';
import { StateRegistry, type StateHandler } from './state.js';

/** `name@version` of this package, the default `sdk` announced in the handshake. */
export const SDK_ID = `${pkg.name}@${pkg.version}`;

/** Minimal WebSocket shape the SDK needs (browser, React Native and Node all provide it). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface ToetsOptions {
  /**
   * The launch payload: base64url or JSON string, or a parsed object. Adapters discover it
   * per platform. Missing or invalid = the SDK stays inert (no hooks, no connection).
   */
  readonly payload: unknown;
  /** Framework announced in the handshake, e.g. `web`, `react-native`. */
  readonly framework: string;
  /** `name@version` announced in the handshake. Defaults to this package. */
  readonly sdk?: string;
  readonly idle?: IdleOptions;
  /** Forward console output and uncaught errors to the host. Default true. */
  readonly logs?: boolean;
  /**
   * Allow an `sdkUrl` that is not loopback (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`).
   * Default false: a crafted deep link must not be able to point the SDK elsewhere.
   */
  readonly allowRemoteHost?: boolean;
  /** WebSocket implementation. Defaults to the global `WebSocket`. */
  readonly WebSocket?: WebSocketConstructor;
  /** Connection attempts after the first one fails before the handshake. Default 5. */
  readonly connectRetries?: number;
}

/**
 * - `inert`: no valid payload; the SDK does nothing.
 * - `ready`: created and instrumented, `start()` not called yet.
 * - `connecting`, `connected`: talking to the host.
 * - `closed`: the session ended normally.
 * - `rejected`: the host refused the handshake (token or protocol version).
 * - `failed`: the host was unreachable, or the payload was refused locally.
 */
export type ToetsStatus =
  'inert' | 'ready' | 'connecting' | 'connected' | 'closed' | 'rejected' | 'failed';

/** Answers one host request: gets its params, returns (or resolves) its result. */
export type HostRequestHandler<M extends HostToAppMethod> = (
  params: HostToAppRequests[M]['params'],
) => HostToAppRequests[M]['result'] | Promise<HostToAppRequests[M]['result']>;

/** Answers which element holds focus, for `focus.changed` notifications. */
export interface FocusSource {
  /** Protocol node id of the focused element, or `null`. */
  current(): string | null;
}

const QUEUE_LIMIT = 500;
const HELLO_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 2000];
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'];

/**
 * The framework-neutral in-app runtime. Adapters create one per app with
 * {@link createToets}, register domain handlers (`tree`, `focus`) and call `start()`.
 */
export class Toets {
  readonly payload: LaunchPayload | null;
  readonly idle: IdleTracker;
  readonly media = new MediaRegistry();

  private statusValue: ToetsStatus;
  private readonly options: ToetsOptions;
  private readonly handlers: Partial<Record<HostToAppMethod, HostRequestHandler<HostToAppMethod>>> =
    {};
  private readonly state: StateRegistry;
  private readonly queue: Array<{ method: string; params: unknown }> = [];
  private readonly cleanups: Array<() => void> = [];
  private readonly statusListeners: Array<(status: ToetsStatus) => void> = [];
  private announced: ReadonlySet<Domain> = new Set();
  private socket: WebSocketLike | null = null;
  private peer: RpcPeer | null = null;
  private attempt = 0;
  private focusSource: FocusSource | null = null;
  private lastFocus: string | null = null;
  private focusCheckScheduled = false;

  constructor(options: ToetsOptions) {
    this.options = options;
    const payload = decodeLaunchPayload(options.payload);
    this.payload = payload && payload.sdkUrl && payload.token ? payload : null;
    this.idle = new IdleTracker(options.idle);
    this.statusValue = this.payload ? 'ready' : 'inert';
    this.state = new StateRegistry(
      this.idle,
      this.payload ? { state: this.payload.state, flags: this.payload.flags } : {},
      (message, error) => this.reportError(message, error),
    );
    this.media.onChanged = (info) => this.notify('media.changed', info);
    if (this.payload) this.instrument();
  }

  /** A valid payload was found: the SDK is (or will be) talking to a toets host. */
  get active(): boolean {
    return this.payload !== null;
  }

  get status(): ToetsStatus {
    return this.statusValue;
  }

  /** The launch payload's mock server URL, for the app's API client. */
  get mockUrl(): string | undefined {
    return this.payload?.mockUrl;
  }

  /** The launch payload's state, for apps that pick their initial route synchronously. */
  get launchState(): string | undefined {
    return this.payload?.state;
  }

  get flags(): LaunchFlags {
    return this.payload?.flags ?? {};
  }

  /** Domains announced in the handshake (empty before it). */
  get domains(): ReadonlySet<Domain> {
    return this.announced;
  }

  /**
   * Registers the handler for a host request. Adapters provide `tree.get`, `focus.get` and
   * `focus.graph`; a domain is announced when all its methods have handlers. Register
   * before `start()`.
   */
  handle<M extends HostToAppMethod>(method: M, handler: HostRequestHandler<M>): void {
    this.handlers[method] = handler as unknown as HostRequestHandler<HostToAppMethod>;
  }

  /** Sends a notification (queued until the handshake completes; dropped when inert). */
  notify<N extends keyof AppToHostNotifications>(
    method: N,
    params: AppToHostNotifications[N],
  ): void {
    const s = this.statusValue;
    if (s === 'connected') {
      if (this.announced.has(NOTIFICATION_DOMAIN[method])) this.peer?.notify(method, params);
    } else if (s === 'ready' || s === 'connecting') {
      if (this.queue.length >= QUEUE_LIMIT) this.queue.shift();
      this.queue.push({ method, params });
    }
  }

  /**
   * Marks the app busy until the returned function is called. Use for work the SDK cannot
   * see (native loads, WebGL scenes, custom transitions). See `docs/idle.md`.
   */
  markBusy(description: string, kind = 'custom'): () => void {
    if (!this.active) return noop;
    return this.idle.begin(kind, description);
  }

  /** Registers an app state handler; it receives the launch state immediately, if any. */
  onState(handler: StateHandler): () => void {
    if (!this.active) return noop;
    return this.state.add(handler);
  }

  /** Forwards a log entry to the host (without writing to the console). */
  log(level: LogLevel, message: string, extra: Pick<LogEntryParams, 'kind' | 'stack'> = {}): void {
    if (this.options.logs === false) return;
    this.notify('logs.entry', { level, message, timestamp: now(), ...extra });
  }

  /** Sets where `focus.changed` notifications read the focused node from. */
  setFocusSource(source: FocusSource): void {
    this.focusSource = source;
    this.lastFocus = safeCurrent(source);
  }

  /**
   * Signals that focus may have moved; emits `focus.changed` (coalesced, deduplicated).
   * Adapters call it from focus events; apps with custom focus engines call it too.
   */
  focusChanged(): void {
    if (!this.active || !this.focusSource || this.focusCheckScheduled) return;
    this.focusCheckScheduled = true;
    setNativeTimeout(() => {
      this.focusCheckScheduled = false;
      const source = this.focusSource;
      if (!source) return;
      const to = safeCurrent(source);
      if (to === this.lastFocus) return;
      const from = this.lastFocus;
      this.lastFocus = to;
      this.notify('focus.changed', { from, to });
    }, 0);
  }

  /** Registers cleanup run when the session ends or `stop()` is called. */
  onStop(cleanup: () => void): void {
    if (
      this.statusValue === 'closed' ||
      this.statusValue === 'rejected' ||
      this.statusValue === 'failed'
    ) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  onStatusChange(listener: (status: ToetsStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      const i = this.statusListeners.indexOf(listener);
      if (i >= 0) this.statusListeners.splice(i, 1);
    };
  }

  /** Connects to the host and performs the handshake. No-op when inert or already started. */
  start(): void {
    if (this.statusValue !== 'ready') return;
    const url = (this.payload as LaunchPayload).sdkUrl as string;
    const problem = checkUrl(url, this.options.allowRemoteHost === true);
    if (problem) {
      sdkWarn(`not connecting: ${problem}`);
      this.finish('failed');
      return;
    }
    this.connect(url);
  }

  /** Closes the session and removes every hook. Idempotent. */
  stop(): void {
    if (this.statusValue === 'inert') return;
    if (
      this.statusValue === 'closed' ||
      this.statusValue === 'rejected' ||
      this.statusValue === 'failed'
    )
      return;
    this.finish('closed');
  }

  private instrument(): void {
    const idle = this.options.idle ?? {};
    this.cleanups.push(instrumentTimers(this.idle, idle.timerThresholdMs ?? 1500));
    if (idle.fetch !== false) this.cleanups.push(instrumentFetch(this.idle));
    if (idle.xhr !== false) this.cleanups.push(instrumentXhr(this.idle));
    if (this.options.logs !== false)
      this.cleanups.push(instrumentConsole((entry) => this.notify('logs.entry', entry)));
  }

  private connect(url: string): void {
    const Impl =
      this.options.WebSocket ?? (getGlobal().WebSocket as WebSocketConstructor | undefined);
    if (!Impl) {
      sdkWarn('not connecting: no WebSocket implementation available');
      this.finish('failed');
      return;
    }
    this.setStatus('connecting');
    let socket: WebSocketLike;
    try {
      socket = new Impl(url);
    } catch (error) {
      this.retryOrFail(`cannot open ${url}: ${String(error)}`);
      return;
    }
    let handshaken = false;
    let rejected = false;
    const peer = new RpcPeer({
      send: (data) => socket.send(data),
      onRequest: (method, params) => this.dispatch(method, params),
      timers: peerTimers,
    });
    this.socket = socket;
    this.peer = peer;
    socket.onmessage = (ev) => peer.receive(ev.data);
    socket.onerror = noop;
    socket.onopen = () => {
      const domains = this.computeDomains();
      // Requests may arrive in the same task as the hello result, before its continuation runs.
      this.announced = new Set(domains);
      peer
        .request(
          HELLO_METHOD,
          {
            protocol: PROTOCOL_VERSION,
            token: (this.payload as LaunchPayload).token,
            sdk: this.options.sdk ?? SDK_ID,
            framework: this.options.framework,
            domains,
          },
          HELLO_TIMEOUT_MS,
        )
        .then(
          (result) => {
            if (this.socket !== socket) return;
            handshaken = true;
            this.setStatus('connected');
            void (result as HelloResult);
            this.flush();
          },
          (error: unknown) => {
            if (this.socket !== socket) return;
            rejected = true;
            const code = error instanceof RpcError ? error.code : undefined;
            const message = error instanceof Error ? error.message : String(error);
            sdkWarn(
              code === RpcErrorCode.IncompatibleProtocol
                ? `the toets host speaks an incompatible protocol (SDK ${PROTOCOL_VERSION}): ${message}`
                : `the toets host rejected the handshake: ${message}`,
            );
            this.finish(code === undefined ? 'failed' : 'rejected');
          },
        );
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      peer.close(new Error('connection closed'));
      if (handshaken) this.finish('closed');
      else if (!rejected) this.retryOrFail(`connection to ${url} closed (code ${ev && ev.code})`);
    };
  }

  private retryOrFail(reason: string): void {
    this.socket = null;
    this.peer = null;
    const retries = this.options.connectRetries ?? RETRY_DELAYS_MS.length;
    if (this.attempt >= retries) {
      sdkWarn(`could not reach the toets host: ${reason}`);
      this.finish('failed');
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)] as number;
    this.attempt++;
    setNativeTimeout(() => {
      if (this.statusValue === 'connecting')
        this.connect((this.payload as LaunchPayload).sdkUrl as string);
    }, delay);
  }

  private computeDomains(): Domain[] {
    const domains: Domain[] = ['sync', 'media', 'state'];
    if (this.handlers['tree.get']) domains.unshift('tree');
    if (this.handlers['tree.get'] && this.handlers['focus.get'] && this.handlers['focus.graph'])
      domains.splice(1, 0, 'focus');
    if (this.options.logs !== false) domains.push('logs');
    return domains;
  }

  private dispatch(method: string, params: unknown): unknown {
    const p = (typeof params === 'object' && params !== null ? params : {}) as Record<
      string,
      unknown
    >;
    const domain = METHOD_DOMAIN[method as HostToAppMethod];
    if (domain === undefined)
      throw new RpcError(RpcErrorCode.MethodNotFound, `Method not found: ${method}`);
    if (!this.announced.has(domain)) {
      throw new RpcError(
        RpcErrorCode.DomainUnavailable,
        `Domain "${domain}" is not available in this SDK`,
      );
    }
    switch (method as HostToAppMethod) {
      case 'sync.waitForIdle': {
        const timeoutMs = p.timeoutMs;
        const quietMs = p.quietMs;
        if (typeof timeoutMs !== 'number' || !(timeoutMs >= 0))
          throw new RpcError(RpcErrorCode.InvalidParams, 'timeoutMs must be a number >= 0');
        if (quietMs !== undefined && (typeof quietMs !== 'number' || !(quietMs >= 0)))
          throw new RpcError(RpcErrorCode.InvalidParams, 'quietMs must be a number >= 0');
        return this.idle.waitForIdle(timeoutMs, quietMs);
      }
      case 'media.get':
        return { media: this.media.get(typeof p.id === 'string' ? p.id : undefined) };
      case 'media.list':
        return { media: this.media.list() };
      case 'state.apply': {
        if (p.state !== undefined && typeof p.state !== 'string')
          throw new RpcError(RpcErrorCode.InvalidParams, 'state must be a string');
        const flags = (
          typeof p.flags === 'object' && p.flags !== null ? p.flags : {}
        ) as LaunchFlags;
        return this.state.apply(p.state as string | undefined, flags).then(() => ({}));
      }
      default: {
        const handler = this.handlers[method as HostToAppMethod];
        if (!handler)
          throw new RpcError(RpcErrorCode.DomainUnavailable, `${method} is not available`);
        return handler(p as never);
      }
    }
  }

  private flush(): void {
    const queued = this.queue.splice(0);
    for (const { method, params } of queued) {
      this.notify(method as keyof AppToHostNotifications, params as never);
    }
  }

  private reportError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    sdkWarn(`${message}: ${detail}`);
    this.log('error', `${message}: ${error instanceof Error ? error.message : String(error)}`, {
      kind: 'uncaught',
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
  }

  private finish(status: 'closed' | 'rejected' | 'failed'): void {
    const socket = this.socket;
    this.socket = null;
    this.peer?.close(new Error('toets SDK stopped'));
    this.peer = null;
    this.queue.length = 0;
    if (socket && socket.readyState <= 1) {
      try {
        socket.close(1000, 'toets SDK stopped');
      } catch {
        // already closing
      }
    }
    const cleanups = this.cleanups.splice(0);
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // keep tearing down
      }
    }
    this.focusSource = null;
    this.setStatus(status);
  }

  private setStatus(status: ToetsStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    for (const listener of this.statusListeners.slice()) {
      try {
        listener(status);
      } catch {
        // listeners must not break the runtime
      }
    }
  }
}

function noop(): void {}

function safeCurrent(source: FocusSource): string | null {
  try {
    return source.current();
  } catch {
    return null;
  }
}

/** Why the SDK refuses to connect to `url`, or `null` when it is acceptable. */
export function checkUrl(url: string, allowRemoteHost: boolean): string | null {
  const m = /^(wss?):\/\/(\[[^\]]*\]|[^/:?#]+)(?::\d+)?(?:[/?#].*)?$/i.exec(url);
  if (!m) return `sdkUrl "${url}" is not a ws:// or wss:// URL`;
  const host = (m[2] as string).toLowerCase();
  if (!allowRemoteHost && LOOPBACK.indexOf(host) < 0) {
    return `sdkUrl host "${host}" is not loopback; pass allowRemoteHost: true to allow it`;
  }
  return null;
}
