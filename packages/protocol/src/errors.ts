/** Machine-readable reasons for {@link ProtocolError}. */
export type ProtocolErrorCode =
  /** The host could not open its WebSocket server. */
  | 'sdk.listen-failed'
  /** `waitForSession` was called with a token this host never issued (or that expired). */
  | 'sdk.unknown-token'
  /** The app did not complete the handshake in time. */
  | 'sdk.session-timeout'
  /** The host was closed while waiting or requesting. */
  | 'sdk.host-closed'
  /** The session closed (app quit, crashed or reloaded) before the request completed. */
  | 'sdk.closed'
  /** The app did not answer a request in time. */
  | 'sdk.request-timeout'
  /** The SDK did not announce the domain, or its protocol version predates the method. */
  | 'sdk.method-unsupported'
  /** The SDK answered with an error. `rpcCode` and `data` carry the details. */
  | 'sdk.remote-error';

/**
 * Error thrown by the host side of the protocol. Shaped like the core's `DpadError`
 * (`code`, `hint`, `docs`) so the core can surface it unchanged.
 */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly hint: string | undefined;
  readonly docs: string | undefined;
  /** JSON-RPC error code for `sdk.remote-error` and `sdk.method-unsupported`. */
  readonly rpcCode: number | undefined;
  readonly data: unknown;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    opts: { hint?: string; docs?: string; rpcCode?: number; data?: unknown; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'ProtocolError';
    this.code = code;
    this.hint = opts.hint;
    this.docs = opts.docs;
    this.rpcCode = opts.rpcCode;
    this.data = opts.data;
  }

  override toString(): string {
    let out = `${this.name} [${this.code}]: ${this.message}`;
    if (this.hint) out += `\nHint: ${this.hint}`;
    if (this.docs) out += `\nDocs: ${this.docs}`;
    return out;
  }
}
