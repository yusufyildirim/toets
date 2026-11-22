import type { WebSocket } from 'ws';
import { ProtocolError } from '../errors.js';
import type { SdkSession } from '../host.js';
import { RpcError, RpcErrorCode } from '../jsonrpc.js';
import {
  CloseCode,
  DOMAINS,
  HELLO_METHOD,
  METHOD_DOMAIN,
  NOTIFICATION_DOMAIN,
  type AppToHostNotifications,
  type Domain,
  type HelloParams,
  type HostToAppMethod,
  type HostToAppRequests,
} from '../messages.js';
import { RpcPeer, RpcTimeoutError } from '../peer.js';
import { protocolSupportsMethod } from '../version.js';

const DOCS = 'reference/protocol/docs/host';
/** Extra time granted on top of `sync.waitForIdle`'s own timeout for the round trip. */
const IDLE_MARGIN_MS = 2000;
/** Per-method cap of notifications buffered before the first listener subscribes. */
const BUFFER_LIMIT = 500;

type Listener = (params: never) => void;

export interface SessionOptions {
  readonly id: string;
  readonly hello: HelloParams;
  readonly socket: WebSocket;
  readonly requestTimeoutMs: number;
  readonly onClosed: (code: number, reason: string) => void;
}

/** Host side of one handshaken connection. */
export class Session implements SdkSession {
  readonly id: string;
  readonly hello: HelloParams;
  readonly domains: ReadonlySet<Domain>;
  readonly closed: Promise<void>;

  private readonly socket: WebSocket;
  private readonly peer: RpcPeer;
  private readonly requestTimeoutMs: number;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly buffered = new Map<string, unknown[]>();
  private readonly rawListeners = new Set<(method: string, params: unknown) => void>();
  private readonly frameListeners = new Set<(data: string) => void>();
  private resolveClosed!: () => void;
  private isClosed = false;
  private alive = true;
  /** Why the host closed the socket, when it did (overrides the code seen by `close`). */
  closeOverride: { code: number; reason: string } | null = null;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.hello = opts.hello;
    this.socket = opts.socket;
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.domains = new Set(
      opts.hello.domains.filter((d) => (DOMAINS as readonly string[]).includes(d)),
    );
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
    this.peer = new RpcPeer({
      send: (data) => this.socket.send(data),
      onRequest: (method) => {
        if (method === HELLO_METHOD) {
          throw new RpcError(RpcErrorCode.InvalidRequest, 'Handshake already completed');
        }
        throw new RpcError(RpcErrorCode.MethodNotFound, `Method not found: ${method}`);
      },
      onNotification: (method, params) => this.dispatch(method, params),
    });
    this.socket.on('message', (data) => {
      const text = data.toString();
      for (const listener of this.frameListeners) listener(text);
      this.peer.receive(text);
    });
    this.socket.on('pong', () => (this.alive = true));
    this.socket.on('close', (code, reason) => {
      const override = this.closeOverride;
      this.finish(override?.code ?? code, override?.reason ?? reason.toString());
      opts.onClosed(override?.code ?? code, override?.reason ?? reason.toString());
    });
  }

  has(method: HostToAppMethod): boolean {
    const domain = METHOD_DOMAIN[method];
    return (
      domain !== undefined &&
      this.domains.has(domain) &&
      protocolSupportsMethod(this.hello.protocol, method)
    );
  }

  request<M extends keyof HostToAppRequests>(
    method: M,
    params: HostToAppRequests[M]['params'],
    opts: { timeoutMs?: number } = {},
  ): Promise<HostToAppRequests[M]['result']> {
    if (!this.has(method)) {
      const domain = METHOD_DOMAIN[method];
      return Promise.reject(
        new ProtocolError(
          'sdk.method-unsupported',
          `The app's SDK (${this.hello.sdk}, protocol ${this.hello.protocol}) does not support ${method}.`,
          {
            hint: this.domains.has(domain)
              ? `${method} needs a newer protocol minor version; upgrade the SDK in the app.`
              : `The SDK did not announce the "${domain}" domain. Check the adapter supports it on this platform.`,
            docs: 'reference/protocol/docs/spec',
            rpcCode: RpcErrorCode.DomainUnavailable,
          },
        ),
      );
    }
    let timeoutMs = opts.timeoutMs;
    if (timeoutMs === undefined) {
      timeoutMs = this.requestTimeoutMs;
      if (method === 'sync.waitForIdle') {
        const idle = params as HostToAppRequests['sync.waitForIdle']['params'];
        timeoutMs = Math.max(timeoutMs, idle.timeoutMs + IDLE_MARGIN_MS);
      }
    }
    return this.requestRaw(method, params, timeoutMs) as Promise<HostToAppRequests[M]['result']>;
  }

  /** Untyped request without the domain check (used by the conformance suite). */
  requestRaw(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    return this.peer.request(method, params, timeoutMs).catch((error: unknown) => {
      throw this.mapError(method, error);
    });
  }

  /** Sends a raw frame (used by the conformance suite to probe error handling). */
  sendRaw(data: string): void {
    if (!this.isClosed) this.socket.send(data);
  }

  /** Observes every received frame before it is parsed (used by the conformance suite). */
  onRawMessage(listener: (data: string) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Observes every notification, known or not (used by the conformance suite). */
  onRawNotification(listener: (method: string, params: unknown) => void): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  on<N extends keyof AppToHostNotifications>(
    method: N,
    listener: (params: AppToHostNotifications[N]) => void,
  ): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(listener as Listener);
    const pending = this.buffered.get(method);
    if (pending) {
      this.buffered.delete(method);
      queueMicrotask(() => {
        for (const params of pending) this.deliver(listener as Listener, params);
      });
    }
    return () => {
      set.delete(listener as Listener);
    };
  }

  close(): Promise<void> {
    if (!this.isClosed) this.socket.close(CloseCode.Normal, 'session closed by host');
    return this.closed;
  }

  /** Pings the app; terminates the session when the previous ping went unanswered. */
  heartbeat(): void {
    if (this.isClosed) return;
    if (!this.alive) {
      this.terminate(CloseCode.Unresponsive, 'heartbeat timeout');
      return;
    }
    this.alive = false;
    try {
      this.socket.ping();
    } catch {
      // socket closing; `close` follows
    }
  }

  /** Terminates without a close handshake (heartbeat failure, host shutdown). */
  terminate(code: number, reason: string): void {
    this.closeOverride = { code, reason };
    this.socket.terminate();
  }

  private dispatch(method: string, params: unknown): void {
    for (const raw of this.rawListeners) raw(method, params);
    const domain = NOTIFICATION_DOMAIN[method as keyof typeof NOTIFICATION_DOMAIN];
    if (domain === undefined) return; // unknown (newer) notification: ignore
    const set = this.listeners.get(method);
    if (set && set.size > 0) {
      for (const listener of Array.from(set)) this.deliver(listener, params);
      return;
    }
    if (set) return; // had listeners that all unsubscribed: drop
    let pending = this.buffered.get(method);
    if (!pending) {
      pending = [];
      this.buffered.set(method, pending);
    }
    if (pending.length >= BUFFER_LIMIT) pending.shift();
    pending.push(params);
  }

  private deliver(listener: Listener, params: unknown): void {
    try {
      listener(params as never);
    } catch {
      // Listener errors belong to the subscriber, not to the connection.
    }
  }

  private finish(code: number, reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.peer.close(
      new ProtocolError(
        'sdk.closed',
        `The app disconnected from the SDK session (code ${code}${reason ? `: ${reason}` : ''}).`,
        {
          hint: 'The app quit, crashed or reloaded. A reloaded app cannot reuse its one-time token; relaunch it through dpad.',
          docs: DOCS,
        },
      ),
    );
    this.resolveClosed();
  }

  private mapError(method: string, error: unknown): unknown {
    if (error instanceof ProtocolError) return error;
    if (error instanceof RpcTimeoutError) {
      return new ProtocolError(
        'sdk.request-timeout',
        `The app did not answer ${method} within ${error.timeoutMs}ms.`,
        {
          hint: "The app's JS thread may be blocked, or the app is paused in a debugger.",
          docs: DOCS,
          cause: error,
        },
      );
    }
    if (error instanceof RpcError) {
      const unsupported =
        error.code === RpcErrorCode.MethodNotFound || error.code === RpcErrorCode.DomainUnavailable;
      return new ProtocolError(
        unsupported ? 'sdk.method-unsupported' : 'sdk.remote-error',
        `The app's SDK failed ${method}: ${error.message} (code ${error.code}).`,
        {
          rpcCode: error.code,
          data: error.data,
          docs: 'reference/protocol/docs/spec',
          cause: error,
        },
      );
    }
    return error;
  }
}
