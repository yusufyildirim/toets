import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { ProtocolError } from '../errors.js';
import type { SdkHost, SdkHostEvent, SdkHostOptions, SdkSession } from '../host.js';
import { RpcErrorCode, type JsonRpcId } from '../jsonrpc.js';
import { CloseCode, HELLO_METHOD, PROTOCOL_VERSION, type HelloParams } from '../messages.js';
import { validateHelloParams } from '../validate.js';
import { isProtocolCompatible } from '../version.js';
import { listenWebSocket, type WsListener } from './listen.js';
import { Session } from './session.js';

const DOCS = 'docs/protocol/host';
const MAX_REMEMBERED_REJECTIONS = 10;

interface Waiter {
  readonly resolve: (session: SdkSession) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface TokenEntry {
  readonly expiresAt: number;
  session: Session | null;
  readonly waiters: Set<Waiter>;
}

type Rejection = Extract<SdkHostEvent, { type: 'rejected' }>;

interface RememberedRejection {
  readonly seq: number;
  readonly event: Rejection;
}

/**
 * Starts the host side of the dpad protocol: a WebSocket server apps connect to.
 * See `docs/host.md`.
 *
 * @example
 * const host = await createSdkHost();
 * const token = host.issueToken();
 * await driver.launch({ payload: { v: 1, sdkUrl: host.url, token } });
 * const session = await host.waitForSession(token, { timeoutMs: 15_000 });
 * const { root } = await session.request('tree.get', {});
 */
export async function createSdkHost(options: SdkHostOptions = {}): Promise<SdkHost> {
  const host = new Host(options);
  await host.listen();
  return host;
}

class Host implements SdkHost {
  private readonly opts: Required<Omit<SdkHostOptions, 'host' | 'onEvent' | 'port'>>;
  private readonly bindHost: string | undefined;
  private readonly requestedPort: number;
  private readonly onEvent: (event: SdkHostEvent) => void;
  private listener: WsListener | undefined;
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly sessions = new Set<Session>();
  private readonly rejections: RememberedRejection[] = [];
  private rejectionSeq = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closing = false;

  constructor(options: SdkHostOptions) {
    this.opts = {
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 10_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
      tokenTtlMs: options.tokenTtlMs ?? 600_000,
      maxPayloadBytes: options.maxPayloadBytes ?? 64 * 1024 * 1024,
    };
    this.bindHost = options.host;
    this.requestedPort = options.port ?? 0;
    const onEvent = options.onEvent;
    this.onEvent = (event) => {
      if (event.type === 'rejected') {
        this.rejections.push({ seq: this.rejectionSeq++, event });
        if (this.rejections.length > MAX_REMEMBERED_REJECTIONS) this.rejections.shift();
      }
      try {
        onEvent?.(event);
      } catch {
        // Diagnostics must never break the host.
      }
    };
  }

  get port(): number {
    return this.listener?.port ?? 0;
  }

  get url(): string {
    return this.listener?.url ?? '';
  }

  async listen(): Promise<void> {
    this.listener = await listenWebSocket({
      host: this.bindHost,
      port: this.requestedPort,
      maxPayload: this.opts.maxPayloadBytes,
      onConnection: (socket, req) => this.accept(socket, req),
    });
    if (this.opts.heartbeatIntervalMs > 0) {
      this.heartbeat = setInterval(() => this.beat(), this.opts.heartbeatIntervalMs);
      this.heartbeat.unref();
    }
  }

  issueToken(): string {
    this.purgeExpiredTokens();
    const token = randomBytes(16).toString('hex');
    this.tokens.set(token, {
      expiresAt: Date.now() + this.opts.tokenTtlMs,
      session: null,
      waiters: new Set(),
    });
    return token;
  }

  waitForSession(token: string, opts: { timeoutMs: number }): Promise<SdkSession> {
    if (this.closing) return Promise.reject(this.hostClosedError());
    const entry = this.tokens.get(token);
    if (!entry || (!entry.session && entry.expiresAt < Date.now() && entry.waiters.size === 0)) {
      return Promise.reject(
        new ProtocolError('sdk.unknown-token', 'waitForSession was called with an unknown token.', {
          hint: 'Use a token returned by issueToken() of the same host, and wait before it expires.',
          docs: DOCS,
        }),
      );
    }
    if (entry.session) return Promise.resolve(entry.session);
    const since = this.rejectionSeq;
    return new Promise<SdkSession>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          entry.waiters.delete(waiter);
          const seen = this.rejections.filter((r) => r.seq >= since).map((r) => r.event);
          reject(this.sessionTimeoutError(opts.timeoutMs, seen));
        }, opts.timeoutMs),
      };
      entry.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const entry of this.tokens.values()) {
      for (const w of entry.waiters) {
        clearTimeout(w.timer);
        w.reject(this.hostClosedError());
      }
      entry.waiters.clear();
    }
    this.tokens.clear();
    const listener = this.listener;
    if (listener) {
      for (const client of listener.wss.clients) client.close(CloseCode.GoingAway, 'host closing');
    }
    const sessions = Array.from(this.sessions, (s) =>
      Promise.race([
        s.closed,
        delay(1000).then(() => s.terminate(CloseCode.GoingAway, 'host closing')),
      ]),
    );
    await Promise.all(sessions);
    await listener?.close();
  }

  private accept(socket: WebSocket, req: IncomingMessage): void {
    if (this.closing) {
      socket.close(CloseCode.GoingAway, 'host closing');
      return;
    }
    this.onEvent({ type: 'connection', remoteAddress: req.socket.remoteAddress });
    socket.on('error', () => {
      // Socket errors surface as `close`; swallow to avoid unhandled 'error' events.
    });

    const timer = setTimeout(() => {
      socket.off('message', onFirstMessage);
      this.reject(socket, null, CloseCode.HandshakeFailed, RpcErrorCode.InvalidRequest, {
        reason: 'handshake-timeout',
        message: `No dpad.hello within ${this.opts.handshakeTimeoutMs}ms`,
      });
    }, this.opts.handshakeTimeoutMs);

    const onFirstMessage = (data: unknown): void => {
      clearTimeout(timer);
      this.handshake(socket, String(data));
    };
    socket.once('message', onFirstMessage);
    socket.once('close', () => clearTimeout(timer));
  }

  private handshake(socket: WebSocket, data: string): void {
    let msg: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        msg = parsed as Record<string, unknown>;
      }
    } catch {
      // handled below
    }
    const id: JsonRpcId | null =
      msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
    if (!msg || msg.jsonrpc !== '2.0' || msg.method !== HELLO_METHOD || id === null) {
      this.reject(socket, id, CloseCode.HandshakeFailed, RpcErrorCode.InvalidRequest, {
        reason: 'invalid-hello',
        message: 'The first message must be a dpad.hello request',
      });
      return;
    }
    const problems = validateHelloParams(msg.params);
    const partial = (typeof msg.params === 'object' && msg.params !== null ? msg.params : {}) as Partial<HelloParams>;
    const hello = withoutToken(partial);
    if (problems.length > 0) {
      this.reject(socket, id, CloseCode.HandshakeFailed, RpcErrorCode.InvalidParams, {
        reason: 'invalid-hello',
        message: `Invalid dpad.hello: ${problems.join('; ')}`,
        hello,
      });
      return;
    }
    const params = msg.params as HelloParams;
    const entry = this.tokens.get(params.token);
    if (!entry || entry.session || entry.expiresAt < Date.now()) {
      this.reject(socket, id, CloseCode.Unauthorized, RpcErrorCode.Unauthorized, {
        reason: 'unauthorized',
        message: entry?.session
          ? 'Token already used (one-time tokens cannot reconnect; relaunch the app)'
          : 'Unknown or expired token',
        hello,
      });
      return;
    }
    if (!isProtocolCompatible(params.protocol, PROTOCOL_VERSION)) {
      this.reject(socket, id, CloseCode.IncompatibleProtocol, RpcErrorCode.IncompatibleProtocol, {
        reason: 'incompatible',
        message: `SDK protocol ${params.protocol} is incompatible with host protocol ${PROTOCOL_VERSION}`,
        hello,
        data: { protocol: PROTOCOL_VERSION },
      });
      return;
    }

    const sessionId = randomUUID();
    const session = new Session({
      id: sessionId,
      hello: params,
      socket,
      requestTimeoutMs: this.opts.requestTimeoutMs,
      onClosed: (code, reason) => {
        this.sessions.delete(session);
        this.onEvent({ type: 'session-closed', sessionId, code, reason });
      },
    });
    entry.session = session;
    this.sessions.add(session);
    socket.send(
      JSON.stringify({ jsonrpc: '2.0', id, result: { protocol: PROTOCOL_VERSION, sessionId } }),
    );
    this.onEvent({ type: 'session', sessionId, hello: params });
    for (const w of entry.waiters) {
      clearTimeout(w.timer);
      w.resolve(session);
    }
    entry.waiters.clear();
  }

  private reject(
    socket: WebSocket,
    id: JsonRpcId | null,
    closeCode: number,
    rpcCode: number,
    info: {
      reason: Rejection['reason'];
      message: string;
      hello?: Partial<HelloParams>;
      data?: unknown;
    },
  ): void {
    const error =
      info.data === undefined
        ? { code: rpcCode, message: info.message }
        : { code: rpcCode, message: info.message, data: info.data };
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, error }));
      socket.close(closeCode, info.reason);
    }
    const event: Rejection =
      info.hello === undefined
        ? { type: 'rejected', reason: info.reason, message: info.message }
        : { type: 'rejected', reason: info.reason, message: info.message, hello: info.hello };
    this.onEvent(event);
  }

  private beat(): void {
    for (const session of this.sessions) session.heartbeat();
  }

  private purgeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (!entry.session && entry.waiters.size === 0 && entry.expiresAt < now) this.tokens.delete(token);
    }
  }

  private sessionTimeoutError(timeoutMs: number, rejections: Rejection[]): ProtocolError {
    const seen = rejections.length
      ? ` Rejected connection attempts meanwhile: ${rejections.map((r) => `${r.reason} (${r.message})`).join('; ')}.`
      : ' No connection attempt reached the host.';
    return new ProtocolError(
      'sdk.session-timeout',
      `The app did not connect to the dpad SDK host within ${timeoutMs}ms.${seen}`,
      {
        hint: rejections.length
          ? 'Fix the rejection reason above (token or protocol version).'
          : 'Check that the app starts the dpad SDK, receives the launch payload (driver transport), can reach the host (adb reverse on Android, cleartext/ATS policy for ws://localhost) and is not a production build without the SDK.',
        docs: DOCS,
      },
    );
  }

  private hostClosedError(): ProtocolError {
    return new ProtocolError('sdk.host-closed', 'The dpad SDK host was closed.', { docs: DOCS });
  }
}

function withoutToken(hello: Partial<HelloParams>): Partial<HelloParams> {
  const copy: Record<string, unknown> = { ...hello };
  delete copy.token;
  return copy as Partial<HelloParams>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
