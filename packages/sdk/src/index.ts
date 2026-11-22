/**
 * dpad in-app SDK, framework-neutral core. Apps usually start it through an adapter
 * (`@dpad-tv/sdk/web`, `@dpad-tv/sdk-react-native`) and use the functions below from app
 * code. Everything is inert without a valid launch payload. See `docs/`.
 */
export {
  createDpad,
  getDpad,
  markBusy,
  onState,
  registerMedia,
  createMediaReporter,
  focusChanged,
} from './global.js';
export {
  Dpad,
  SDK_ID,
  checkUrl,
  type DpadOptions,
  type DpadStatus,
  type FocusSource,
  type WebSocketConstructor,
  type WebSocketLike,
} from './runtime.js';
export {
  IdleTracker,
  type BusyProbe,
  type IdleIgnoreRule,
  type IdleOptions,
  type IdleResult,
} from './idle.js';
export type { MediaProvider, MediaReporter, MediaSnapshot, MediaSource } from './media.js';
export type { StateHandler } from './state.js';
export { describeRequest } from './instrument/network.js';
export { formatLogArgs } from './instrument/console.js';
export { getGlobal } from './env.js';
