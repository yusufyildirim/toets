import { RpcError, RpcErrorCode, type JsonRpcId } from './jsonrpc.js';

/** Timer functions the peer uses. SDKs pass untracked natives so idle tracking ignores them. */
export interface PeerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RpcPeerOptions {
  /** Sends one serialized message (one WebSocket text frame). */
  send(data: string): void;
  /** Answers an incoming request. Throw {@link RpcError} for a specific error code. */
  onRequest?(method: string, params: unknown): unknown;
  onNotification?(method: string, params: unknown): void;
  timers?: PeerTimers;
}

/** Rejection reason of {@link RpcPeer.request} when no response arrives in time. */
export class RpcTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`${method} timed out after ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
  }
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: unknown;
}

const defaultTimers: PeerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Transport-agnostic JSON-RPC 2.0 peer: correlates requests and responses, applies timeouts,
 * dispatches incoming requests and notifications and answers malformed input with the
 * right error object. Used by the host and by JS SDKs; other SDKs implement the same rules
 * (see `docs/spec.md`).
 */
export class RpcPeer {
  private readonly options: RpcPeerOptions;
  private readonly timers: PeerTimers;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private nextId = 1;
  private closedReason: Error | null = null;

  constructor(options: RpcPeerOptions) {
    this.options = options;
    this.timers = options.timers ?? defaultTimers;
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /** Sends a request and resolves with its result. Rejects with {@link RpcError} or {@link RpcTimeoutError}. */
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closedReason) return Promise.reject(this.closedReason);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.settle(id);
        reject(error);
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closedReason) return;
    this.write({ jsonrpc: '2.0', method, params });
  }

  /** Feeds one received frame. Never throws. */
  receive(data: unknown): void {
    if (this.closedReason) return;
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      this.respondError(null, RpcErrorCode.ParseError, 'Parse error');
      return;
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      this.respondError(null, RpcErrorCode.InvalidRequest, 'Invalid request (batches are not supported)');
      return;
    }
    const m = msg as Record<string, unknown>;
    const id = isId(m.id) ? m.id : undefined;
    if (m.jsonrpc !== '2.0') {
      this.respondError(id ?? null, RpcErrorCode.InvalidRequest, 'Invalid request: jsonrpc must be "2.0"');
      return;
    }
    if (typeof m.method === 'string') {
      if (id === undefined) {
        if (m.id !== undefined) {
          this.respondError(null, RpcErrorCode.InvalidRequest, 'Invalid request: bad id');
          return;
        }
        this.handleNotification(m.method, m.params);
      } else {
        this.handleRequest(id, m.method, m.params);
      }
      return;
    }
    if (id !== undefined && ('result' in m || 'error' in m)) {
      this.handleResponse(id, m);
      return;
    }
    if ('result' in m || 'error' in m) return; // response to nothing we track (id null)
    this.respondError(id ?? null, RpcErrorCode.InvalidRequest, 'Invalid request');
  }

  /** Rejects every pending request with `reason` and stops sending. Idempotent. */
  close(reason: Error): void {
    if (this.closedReason) return;
    this.closedReason = reason;
    const pending = Array.from(this.pending.keys());
    for (const id of pending) {
      const p = this.settle(id);
      if (p) p.reject(reason);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    try {
      this.options.onNotification?.(method, params);
    } catch {
      // A failing listener must not break the connection.
    }
  }

  private handleRequest(id: JsonRpcId, method: string, params: unknown): void {
    const onRequest = this.options.onRequest;
    if (!onRequest) {
      this.respondError(id, RpcErrorCode.MethodNotFound, `Method not found: ${method}`);
      return;
    }
    let result: unknown;
    try {
      result = onRequest(method, params);
    } catch (error) {
      this.respondFailure(id, error);
      return;
    }
    Promise.resolve(result).then(
      (value) => {
        if (this.closedReason) return;
        this.write({ jsonrpc: '2.0', id, result: value === undefined ? null : value });
      },
      (error: unknown) => this.respondFailure(id, error),
    );
  }

  private handleResponse(id: JsonRpcId, m: Record<string, unknown>): void {
    const p = this.settle(id);
    if (!p) return;
    if ('error' in m) {
      const e = m.error as Record<string, unknown> | null;
      const code = e && typeof e.code === 'number' ? e.code : RpcErrorCode.InternalError;
      const message = e && typeof e.message === 'string' ? e.message : 'Unknown error';
      p.reject(new RpcError(code, message, e ? e.data : undefined));
    } else {
      p.resolve(m.result);
    }
  }

  private settle(id: JsonRpcId): Pending | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    this.pending.delete(id);
    this.timers.clearTimeout(p.timer);
    return p;
  }

  private respondFailure(id: JsonRpcId, error: unknown): void {
    if (error instanceof RpcError || isRpcErrorLike(error)) {
      const e = error as RpcError;
      this.respondError(id, e.code, e.message, e.data);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      this.respondError(id, RpcErrorCode.InternalError, message || 'Internal error');
    }
  }

  private respondError(id: JsonRpcId | null, code: number, message: string, data?: unknown): void {
    if (this.closedReason) return;
    const error = data === undefined ? { code, message } : { code, message, data };
    this.write({ jsonrpc: '2.0', id, error });
  }

  private write(message: object): void {
    this.options.send(JSON.stringify(message));
  }
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && isFinite(value));
}

// Duck-typed so errors thrown across bundle copies of this package still map correctly.
function isRpcErrorLike(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'RpcError' &&
    typeof (error as { code?: unknown }).code === 'number'
  );
}
