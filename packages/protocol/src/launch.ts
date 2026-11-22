/**
 * The launch payload is the single channel through which the test host configures an app
 * at launch: where the SDK host and mock server live, and which state to start in.
 *
 * Transport per platform (owned by drivers, decoded by SDKs):
 * - web: `?__dpad=<base64url(JSON)>` query parameter (or `window.__DPAD__` via init script)
 * - Android: intent string extra `__dpad`
 * - tvOS: launch arguments `-__dpad <value>`
 *
 * Drivers should send the base64url form ({@link encodeLaunchPayloadParam}) everywhere: it
 * survives shells, URLs and `NSUserDefaults` argument parsing unchanged. SDKs accept both
 * the base64url and the plain JSON form ({@link decodeLaunchPayload}).
 */
import type { LaunchFlags } from './messages.js';

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
  readonly flags?: LaunchFlags;
}

/** Name of the launch parameter on every platform. */
export const LAUNCH_PARAM = '__dpad';

/** Global the web driver may set through an init script instead of the query parameter. */
export const LAUNCH_GLOBAL = '__DPAD__';

/** Header the app adds to proxied requests so the mock server can forward unmatched ones. */
export const ORIGINAL_ORIGIN_HEADER = 'x-dpad-original-origin';

/** Plain JSON form of the payload. */
export function encodeLaunchPayload(payload: LaunchPayload): string {
  return JSON.stringify(payload);
}

/** Base64url (no padding) of the JSON form: safe in URLs, shells and launch arguments. */
export function encodeLaunchPayloadParam(payload: LaunchPayload): string {
  return base64UrlEncode(utf8Encode(encodeLaunchPayload(payload)));
}

/**
 * Decodes a payload from its JSON form, its base64url form or an already parsed object.
 * Returns `null` for anything missing or malformed so SDKs stay inert.
 */
export function decodeLaunchPayload(raw: unknown): LaunchPayload | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    try {
      value = JSON.parse(text.charAt(0) === '{' ? text : utf8Decode(base64UrlDecode(text)));
    } catch {
      return null;
    }
  }
  return isLaunchPayload(value) ? value : null;
}

function isLaunchPayload(value: unknown): value is LaunchPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (p.v !== 1) return false;
  for (const key of ['sdkUrl', 'token', 'mockUrl', 'state'] as const) {
    if (p[key] !== undefined && typeof p[key] !== 'string') return false;
  }
  if (p.sdkUrl !== undefined && !p.token) return false;
  if (p.flags !== undefined) {
    if (typeof p.flags !== 'object' || p.flags === null || Array.isArray(p.flags)) return false;
    const flags = p.flags as Record<string, unknown>;
    for (const name of Object.keys(flags)) {
      const t = typeof flags[name];
      if (t !== 'string' && t !== 'number' && t !== 'boolean') return false;
    }
  }
  return true;
}

// Dependency-free UTF-8 and base64url so the codec runs unchanged in browsers, old TV
// engines, Hermes and Node.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++] as number;
    let c: number;
    if (b < 0x80) c = b;
    else if (b >= 0xf0)
      c = ((b & 7) << 18) | (cont(bytes, i++) << 12) | (cont(bytes, i++) << 6) | cont(bytes, i++);
    else if (b >= 0xe0) c = ((b & 15) << 12) | (cont(bytes, i++) << 6) | cont(bytes, i++);
    else if (b >= 0xc0) c = ((b & 31) << 6) | cont(bytes, i++);
    else throw new Error('invalid utf-8');
    if (c >= 0x10000) {
      c -= 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

function cont(bytes: number[], i: number): number {
  const b = bytes[i];
  if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('invalid utf-8');
  return b & 63;
}

function base64UrlEncode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET.charAt(a >> 2);
    out += ALPHABET.charAt(((a & 3) << 4) | ((b ?? 0) >> 4));
    if (b !== undefined) out += ALPHABET.charAt(((b & 15) << 2) | ((c ?? 0) >> 6));
    if (c !== undefined) out += ALPHABET.charAt(c & 63);
  }
  return out;
}

function base64UrlDecode(text: string): number[] {
  // Accept standard base64 and padding too: drivers and shells sometimes produce them.
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = ALPHABET.indexOf(clean.charAt(i));
    if (v < 0) throw new Error('invalid base64url');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}
