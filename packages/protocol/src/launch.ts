/**
 * The launch payload is the single channel through which the test host configures an app
 * at launch: where the SDK host and mock server live, and which state to start in.
 *
 * Transport per platform (owned by drivers, decoded by SDKs):
 * - web: `?__dpad=<base64url(JSON)>` query parameter (or `window.__DPAD__` via init script)
 * - Android: intent string extra `__dpad` holding the JSON
 * - tvOS: launch arguments `-__dpad <JSON>`
 */
export interface LaunchPayload {
  /** Payload format version. */
  readonly v: 1;
  /** WebSocket URL of the dpad SDK host, e.g. `ws://localhost:9323`. Absent = black-box run. */
  readonly sdkUrl?: string;
  /** One-time token the SDK must present in its handshake. Required when `sdkUrl` is set. */
  readonly token?: string;
  /** Base URL of the dpad mock server the app should send API traffic to. */
  readonly mockUrl?: string;
  /** Named app state to launch into (app-defined, applied through the SDK `state` domain). */
  readonly state?: string;
  /** Feature flags for this launch (app-defined). */
  readonly flags?: Readonly<Record<string, string | number | boolean>>;
}

/** Name of the launch parameter on every platform. */
export const LAUNCH_PARAM = '__dpad';

/** Header the app adds to proxied requests so the mock server can forward unmatched ones. */
export const ORIGINAL_ORIGIN_HEADER = 'x-dpad-original-origin';

export function encodeLaunchPayload(payload: LaunchPayload): string {
  return JSON.stringify(payload);
}

/** Decodes a payload, returning `null` for anything malformed so SDKs stay inert. */
export function decodeLaunchPayload(raw: string | null | undefined): LaunchPayload | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const p = value as Record<string, unknown>;
    if (p.v !== 1) return null;
    if (p.sdkUrl !== undefined && typeof p.token !== 'string') return null;
    return value as LaunchPayload;
  } catch {
    return null;
  }
}
