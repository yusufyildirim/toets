/**
 * Inert stand-in for `@dpad-tv/sdk` and `@dpad-tv/sdk/web` with the same app-facing API.
 * Alias the SDK to this module in production builds to ship zero SDK code while keeping
 * calls like `markBusy()` and `onState()` in app code. See `docs/production.md`.
 */
import type { MediaReporter, MediaSnapshot, MediaSource } from './media.js';
import type { Dpad } from './runtime.js';
import type { StateHandler } from './state.js';

export type * from './index.js';

function noop(): void {}

const inert = {
  payload: null,
  active: false,
  status: 'inert',
  mockUrl: undefined,
  launchState: undefined,
  flags: {},
  domains: new Set(),
  handle: noop,
  notify: noop,
  markBusy: () => noop,
  onState: () => noop,
  log: noop,
  setFocusSource: noop,
  focusChanged: noop,
  onStop: noop,
  onStatusChange: () => noop,
  start: noop,
  stop: noop,
} as unknown as Dpad;

export function startDpad(_options?: unknown): Dpad {
  return inert;
}
export function createDpad(_options?: unknown): Dpad {
  return inert;
}
export function getDpad(): Dpad | null {
  return null;
}
export function markBusy(_description: string, _kind?: string): () => void {
  return noop;
}
export function onState(_handler: StateHandler): () => void {
  return noop;
}
export function registerMedia(_id: string, _source: MediaSource): () => void {
  return noop;
}
export function createMediaReporter(
  _id: string,
  initial: Partial<MediaSnapshot> = {},
): MediaReporter {
  const snapshot: MediaSnapshot = {
    state: 'idle',
    position: 0,
    duration: null,
    rate: 1,
    ...initial,
  };
  return { update: noop, snapshot, dispose: noop };
}
export function focusChanged(): void {}
