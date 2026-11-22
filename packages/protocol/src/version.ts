import { METHOD_SINCE, type HostToAppMethod } from './messages.js';

export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parses `major.minor.patch` (pre-release and build suffixes are ignored). `null` if invalid. */
export function parseProtocolVersion(version: unknown): ProtocolVersion | null {
  if (typeof version !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Two protocol versions interoperate when their majors match. */
export function isProtocolCompatible(a: string, b: string): boolean {
  const pa = parseProtocolVersion(a);
  const pb = parseProtocolVersion(b);
  return pa !== null && pb !== null && pa.major === pb.major;
}

/** Whether an SDK announcing `sdkProtocol` can answer `method` (by protocol version only). */
export function protocolSupportsMethod(sdkProtocol: string, method: HostToAppMethod): boolean {
  const sdk = parseProtocolVersion(sdkProtocol);
  const since = parseProtocolVersion(`${METHOD_SINCE[method]}.0`);
  if (!sdk || !since) return false;
  return sdk.major === since.major && sdk.minor >= since.minor;
}
