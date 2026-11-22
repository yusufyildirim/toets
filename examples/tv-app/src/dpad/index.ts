/**
 * The dpad seam of the example app. Everything dpad-specific lives in this folder:
 * reading the launch payload and routing API traffic to the mock server.
 *
 * Phase 2: wire `@dpad-tv/sdk-react-native` here (start it with the payload, register media
 * and state handlers). The rest of the app must not import dpad packages directly.
 */
import type { LaunchPayload } from './launchPayload';
import { readLaunchPayload } from './readLaunchPayload';

export { ORIGINAL_ORIGIN_HEADER, type LaunchPayload } from './launchPayload';

let cached: LaunchPayload | null | undefined;

/** The payload this process was launched with, or `null` for a normal (non-test) launch. */
export function getLaunchPayload(): LaunchPayload | null {
  if (cached === undefined) cached = readLaunchPayload();
  return cached;
}
