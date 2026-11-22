/**
 * Host side of the dpad protocol (Node only). Import from `@dpad-tv/protocol/host`.
 */
export { createSdkHost } from './host.js';
export type { SdkHost, SdkHostEvent, SdkHostOptions, SdkSession } from '../host.js';
export { ProtocolError, type ProtocolErrorCode } from '../errors.js';
