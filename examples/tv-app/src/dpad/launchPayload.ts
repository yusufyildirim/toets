/**
 * The dpad launch payload, as seen by the app.
 *
 * This mirrors `LaunchPayload` v1 from `@dpad-tv/protocol` on purpose: the example app reads
 * the payload itself so it works without the dpad SDK. Phase 2 replaces this folder's reader
 * with `@dpad-tv/sdk-react-native`, which owns decoding and the SDK connection.
 */
export interface LaunchPayload {
  readonly v: 1;
  readonly sdkUrl?: string;
  readonly token?: string;
  /** Base URL of the dpad mock server the app should send API traffic to. */
  readonly mockUrl?: string;
  readonly state?: string;
  readonly flags?: Readonly<Record<string, string | number | boolean>>;
}

/** Name of the launch parameter on every platform (URL param, intent extra, launch arg). */
export const LAUNCH_PARAM = '__dpad';

/** Header carrying the real API origin when requests are routed to the mock server. */
export const ORIGINAL_ORIGIN_HEADER = 'x-dpad-original-origin';

/** Parses a JSON payload, returning `null` for anything malformed so the app stays inert. */
export function parseLaunchPayload(raw: unknown): LaunchPayload | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const payload = value as Record<string, unknown>;
  if (payload.v !== 1) return null;
  if (payload.mockUrl !== undefined && !isHttpUrl(payload.mockUrl)) return null;
  return value as LaunchPayload;
}

/**
 * Decodes the launch parameter as every dpad driver sends it: base64url-encoded JSON. Raw JSON
 * and already parsed objects are accepted too.
 */
export function decodeLaunchParam(param: unknown): LaunchPayload | null {
  if (!param) return null;
  if (typeof param !== 'string' || param.trimStart().startsWith('{')) {
    return parseLaunchPayload(param);
  }
  try {
    const base64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return parseLaunchPayload(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
