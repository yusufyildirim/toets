/**
 * dpad in-app SDK protocol: message types, launch payload codec, versioning rules and a
 * transport-agnostic JSON-RPC peer. Browser, Hermes and Node safe.
 *
 * Node-only parts live in subpaths: `@dpad-tv/protocol/host` (the WebSocket host) and
 * `@dpad-tv/protocol/conformance` (the SDK conformance suite).
 */
export * from './launch.js';
export * from './jsonrpc.js';
export * from './messages.js';
export * from './version.js';
export * from './errors.js';
export { RpcPeer, RpcTimeoutError, type RpcPeerOptions, type PeerTimers } from './peer.js';
export type * from './host.js';
