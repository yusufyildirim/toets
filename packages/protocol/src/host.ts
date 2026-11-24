/**
 * Host-side SDK connection contract (implemented in `@toets/protocol/host`, consumed by
 * the core). The host listens; apps connect using the launch payload's `sdkUrl` + `token`.
 */
import type {
  AppToHostNotifications,
  Domain,
  HelloParams,
  HostToAppMethod,
  HostToAppRequests,
} from './messages.js';

/** One connected app, after a successful handshake. */
export interface SdkSession {
  readonly id: string;
  readonly hello: HelloParams;
  /** Domains announced by the SDK that this host understands. */
  readonly domains: ReadonlySet<Domain>;
  /** Whether the SDK can answer `method`: its domain was announced and its protocol is recent enough. */
  has(method: HostToAppMethod): boolean;
  /**
   * Sends a request. Rejects with `ProtocolError`: `sdk.method-unsupported` (without sending)
   * when {@link has} is false, `sdk.request-timeout`, `sdk.closed` or `sdk.remote-error`.
   * The default timeout of `sync.waitForIdle` is its own `timeoutMs` plus a margin.
   */
  request<M extends keyof HostToAppRequests>(
    method: M,
    params: HostToAppRequests[M]['params'],
    opts?: { timeoutMs?: number },
  ): Promise<HostToAppRequests[M]['result']>;
  /**
   * Subscribes to a notification. Notifications that arrive before the first listener of a
   * method subscribes are buffered (bounded) and delivered to it asynchronously, so startup
   * logs are not lost between the handshake and the core's subscription.
   */
  on<N extends keyof AppToHostNotifications>(
    method: N,
    listener: (params: AppToHostNotifications[N]) => void,
  ): () => void;
  /** Resolves when the app disconnects (or the session is closed by the host). */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface SdkHost {
  /** `ws://localhost:port`: valid on the host, the tvOS simulator and (after `adb reverse`) Android. */
  readonly url: string;
  readonly port: number;
  /** Issues a one-time token for the next launch. */
  issueToken(): string;
  /** Waits for the app launched with `token` to complete the handshake. */
  waitForSession(token: string, opts: { timeoutMs: number }): Promise<SdkSession>;
  close(): Promise<void>;
}

/** Diagnostic events of an `SdkHost`, for logs and failure reports. */
export type SdkHostEvent =
  | { readonly type: 'connection'; readonly remoteAddress: string | undefined }
  | {
      readonly type: 'rejected';
      readonly reason: 'unauthorized' | 'incompatible' | 'invalid-hello' | 'handshake-timeout';
      readonly message: string;
      readonly hello?: Partial<HelloParams>;
    }
  | { readonly type: 'session'; readonly sessionId: string; readonly hello: HelloParams }
  | {
      readonly type: 'session-closed';
      readonly sessionId: string;
      readonly code: number;
      readonly reason: string;
    };

export interface SdkHostOptions {
  /** Port to listen on. Default `0` (a free port). */
  readonly port?: number;
  /**
   * Interface to bind. Default: loopback only (`127.0.0.1` and, when available, `::1` on the
   * same port, so `localhost` works whichever address family the app resolves first).
   */
  readonly host?: string;
  /** Time an app has to send a valid `toets.hello` after connecting. Default 10000. */
  readonly handshakeTimeoutMs?: number;
  /** Default per-request timeout. Default 10000. */
  readonly requestTimeoutMs?: number;
  /** WebSocket ping interval; a session missing two pongs is closed. `0` disables. Default 5000. */
  readonly heartbeatIntervalMs?: number;
  /** Unused tokens expire after this long. Default 600000 (10 min). */
  readonly tokenTtlMs?: number;
  /** Largest accepted frame. Default 64 MiB (trees of big screens are large). */
  readonly maxPayloadBytes?: number;
  readonly onEvent?: (event: SdkHostEvent) => void;
}
