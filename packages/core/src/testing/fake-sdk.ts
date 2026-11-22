/**
 * In-memory SDK host and session for unit tests. The session answers protocol requests from a
 * {@link FakeDriver} screen, so the same fake drives both the black-box and the SDK path.
 */
import {
  METHOD_DOMAIN,
  ProtocolError,
  type AppToHostNotifications,
  type BusyResource,
  type Domain,
  type HelloParams,
  type HostToAppMethod,
  type HostToAppRequests,
  type MediaInfo,
  type SdkHost,
  type SdkSession,
} from '@dpad-tv/protocol';
import type { FakeDriver } from './fake-driver.js';

const ALL_DOMAINS: readonly Domain[] = ['tree', 'focus', 'sync', 'media', 'state', 'logs'];

export interface FakeSdkSessionOptions {
  /** Domains announced in the handshake. Default: tree, focus, sync, media, state, logs. */
  readonly domains?: readonly Domain[];
  readonly token?: string;
}

type Listener = (params: never) => void;

export class FakeSdkSession implements SdkSession {
  readonly id: string;
  readonly hello: HelloParams;
  readonly domains: ReadonlySet<Domain>;
  readonly closed: Promise<void>;
  /** Current media state answered to `media.get`. */
  media: MediaInfo | null = null;
  /** Answer to `sync.waitForIdle`. A function is called with the request params. */
  idle:
    | { idle: boolean; busy: readonly BusyResource[] }
    | ((params: { timeoutMs: number; quietMs?: number }) => {
        idle: boolean;
        busy: readonly BusyResource[];
      }) = {
    idle: true,
    busy: [],
  };
  /** Every request received, in order. */
  readonly requests: { method: keyof HostToAppRequests; params: unknown }[] = [];
  /** Methods that should reject (simulates a broken SDK). */
  readonly failing = new Set<keyof HostToAppRequests>();
  isClosed = false;

  private readonly listeners = new Map<string, Set<Listener>>();
  private resolveClosed!: () => void;
  private static counter = 0;

  constructor(
    private readonly driver: FakeDriver,
    opts: FakeSdkSessionOptions = {},
  ) {
    this.id = `fake-session-${++FakeSdkSession.counter}`;
    const domains = opts.domains ?? ALL_DOMAINS;
    this.domains = new Set(domains);
    this.hello = {
      protocol: '1.0.0',
      token: opts.token ?? 'fake-token',
      sdk: '@dpad-tv/fake-sdk@0.0.0',
      framework: 'fake',
      domains,
    };
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
  }

  has(method: HostToAppMethod): boolean {
    return this.domains.has(METHOD_DOMAIN[method]);
  }

  async request<M extends keyof HostToAppRequests>(
    method: M,
    params: HostToAppRequests[M]['params'],
  ): Promise<HostToAppRequests[M]['result']> {
    if (!this.has(method)) {
      throw new ProtocolError('sdk.method-unsupported', `The SDK does not support ${method}.`);
    }
    this.requests.push({ method, params });
    if (this.isClosed) throw new ProtocolError('sdk.closed', 'The SDK session is closed.');
    if (this.failing.has(method)) {
      throw new ProtocolError('sdk.remote-error', `fake ${method} failure`, { rpcCode: -32603 });
    }
    const answer = (): unknown => {
      switch (method) {
        case 'tree.get':
          return { root: this.driver.protocolTree(), viewport: this.driver.viewportSize };
        case 'focus.get': {
          const find = (n: ReturnType<FakeDriver['protocolTree']>): typeof n | null =>
            n.focused ? n : (n.children.map(find).find((c) => c !== null) ?? null);
          return { node: find(this.driver.protocolTree()) };
        }
        case 'focus.graph':
          return { nodes: this.driver.focusGraph() };
        case 'sync.waitForIdle': {
          const p = params as { timeoutMs: number; quietMs?: number };
          return typeof this.idle === 'function' ? this.idle(p) : this.idle;
        }
        case 'media.get':
          return { media: this.media };
        case 'media.list':
          return { media: this.media ? [this.media] : [] };
        case 'state.apply':
          return {};
        default:
          throw new Error(`unknown method ${String(method)}`);
      }
    };
    return answer() as HostToAppRequests[M]['result'];
  }

  on<N extends keyof AppToHostNotifications>(
    method: N,
    listener: (params: AppToHostNotifications[N]) => void,
  ): () => void {
    const set = this.listeners.get(method) ?? new Set<Listener>();
    this.listeners.set(method, set);
    set.add(listener as Listener);
    return () => set.delete(listener as Listener);
  }

  /** Sends a notification from the "app" to the host. */
  notify<N extends keyof AppToHostNotifications>(
    method: N,
    params: AppToHostNotifications[N],
  ): void {
    for (const l of this.listeners.get(method) ?? [])
      (l as (p: AppToHostNotifications[N]) => void)(params);
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    this.resolveClosed();
  }
}

export interface FakeSdkHostOptions extends FakeSdkSessionOptions {
  /** When false, `waitForSession` times out (an app without the SDK). Default true. */
  readonly connect?: boolean;
}

export class FakeSdkHost implements SdkHost {
  readonly url = 'ws://localhost:9323';
  readonly port = 9323;
  /** Tokens issued, in order. */
  readonly tokens: string[] = [];
  /** Sessions handed out, in order. */
  readonly sessions: FakeSdkSession[] = [];
  connect: boolean;
  closedHost = false;

  constructor(
    private readonly driver: FakeDriver,
    private readonly opts: FakeSdkHostOptions = {},
  ) {
    this.connect = opts.connect ?? true;
  }

  /** The session of the latest launch. */
  get session(): FakeSdkSession | undefined {
    return this.sessions.at(-1);
  }

  issueToken(): string {
    const token = `token-${this.tokens.length + 1}`;
    this.tokens.push(token);
    return token;
  }

  async waitForSession(token: string, opts: { timeoutMs: number }): Promise<SdkSession> {
    if (!this.connect) {
      await new Promise((r) => setTimeout(r, Math.min(opts.timeoutMs, 50)));
      throw new Error(`no app connected with ${token} within ${opts.timeoutMs}ms`);
    }
    const session = new FakeSdkSession(this.driver, { ...this.opts, token });
    this.sessions.push(session);
    return session;
  }

  async close(): Promise<void> {
    this.closedHost = true;
  }
}
