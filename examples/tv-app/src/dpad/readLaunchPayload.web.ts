import {
  decodeWebLaunchParam,
  LAUNCH_PARAM,
  parseLaunchPayload,
  type LaunchPayload,
} from './launchPayload';

declare global {
  interface Window {
    /** Set by an init script as an alternative to the URL parameter. */
    __DPAD__?: unknown;
  }
}

/** Reads the launch payload on web: `window.__DPAD__` first, then the `?__dpad=` parameter. */
export function readLaunchPayload(): LaunchPayload | null {
  if (window.__DPAD__ !== undefined) return parseLaunchPayload(window.__DPAD__);
  return decodeWebLaunchParam(new URLSearchParams(window.location.search).get(LAUNCH_PARAM));
}
