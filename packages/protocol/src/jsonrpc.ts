/** Minimal JSON-RPC 2.0 envelope types used by the dpad protocol. */

export type JsonRpcId = number | string;

export interface JsonRpcRequest<M extends string = string, P = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: M;
  readonly params?: P;
}

export interface JsonRpcNotification<M extends string = string, P = unknown> {
  readonly jsonrpc: '2.0';
  readonly method: M;
  readonly params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: R;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcFailure;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard and dpad-specific error codes. */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** Handshake token missing or wrong. */
  Unauthorized: -32001,
  /** Protocol major version mismatch. */
  IncompatibleProtocol: -32002,
  /** Domain not implemented by this SDK. */
  DomainUnavailable: -32003,
  /** An app-registered handler (e.g. an `onState` handler) failed or is missing. */
  HandlerFailed: -32004,
  /** A referenced node or player does not exist (anymore). */
  NotFound: -32005,
} as const;

/**
 * An error that maps to a JSON-RPC error object. Request handlers throw it to answer with a
 * specific code; requesters receive it when the peer answers with an error.
 */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}
