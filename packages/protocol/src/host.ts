/**
 * Host-side SDK connection contract (implemented by the `protocol` workstream, consumed by
 * the core). The host listens; apps connect using the launch payload's `sdkUrl` + `token`.
 */
import type { AppToHostNotifications, Domain, HelloParams, HostToAppRequests } from './messages.js';

export interface SdkSession {
  readonly id: string;
  readonly hello: HelloParams;
  readonly domains: ReadonlySet<Domain>;
  request<M extends keyof HostToAppRequests>(
    method: M,
    params: HostToAppRequests[M]['params'],
    opts?: { timeoutMs?: number },
  ): Promise<HostToAppRequests[M]['result']>;
  on<N extends keyof AppToHostNotifications>(
    method: N,
    listener: (params: AppToHostNotifications[N]) => void,
  ): () => void;
  /** Resolves when the app disconnects. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface SdkHost {
  /** `ws://host:port`, as seen from the host machine. Drivers translate for devices. */
  readonly url: string;
  readonly port: number;
  /** Issues a one-time token for the next launch. */
  issueToken(): string;
  /** Waits for the app launched with `token` to complete the handshake. */
  waitForSession(token: string, opts: { timeoutMs: number }): Promise<SdkSession>;
  close(): Promise<void>;
}
