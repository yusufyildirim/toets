/**
 * The dpad seam of the example app. Everything dpad-specific lives in this folder; the rest of
 * the app imports from here, never from dpad packages. The SDK itself starts in `start.ts`.
 *
 * All of it is safe without dpad: in production builds the SDK is the inert no-op module, and
 * in black-box runs (dpad without the SDK session) only the launch payload is read.
 */
import { getLaunchPayload, navigationIdleListeners, onState } from '@dpad-tv/sdk-react-native';
import { useEffect, useRef } from 'react';

export { usePlayerMedia } from './media';

/** Header carrying the real API origin when requests are routed to the mock server. */
export const ORIGINAL_ORIGIN_HEADER = 'x-dpad-original-origin';

/**
 * Base URL of the dpad mock server, when dpad launched the app with network mocking. Works with
 * and without the SDK session. On Android the payload arrives with the first render, so call
 * it lazily, never at module load.
 */
export function getMockUrl(): string | undefined {
  return getLaunchPayload()?.mockUrl;
}

/** True when dpad launched the app (with or without the SDK session). */
export function isLaunchedByDpad(): boolean {
  return getLaunchPayload() !== null;
}

/** Launch flags the app understands. Names and values are shared with the e2e suite. */
export interface LaunchFlags {
  readonly autoplay?: boolean;
}

/**
 * Applies the launch state (`app.launch({ state, flags })`) and later `state.apply` requests.
 * The app counts as busy until `handler` settles, so tests start on the applied state.
 */
export function useLaunchState(
  handler: (state: string | undefined, flags: LaunchFlags) => void | Promise<void>,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(
    () =>
      onState((state, flags) => {
        const { autoplay } = flags;
        return ref.current(state, typeof autoplay === 'boolean' ? { autoplay } : {});
      }),
    [],
  );
}

/**
 * Screen transition tracking for idle sync: a focus scope is "transitioning" from the moment it
 * is asked to take focus until its element is focused, so assertions after a navigation wait
 * for focus to land instead of polling.
 */
export const navigationIdle = navigationIdleListeners();
