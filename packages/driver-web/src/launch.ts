import { LAUNCH_PARAM, encodeLaunchPayloadParam, type LaunchPayload } from '@dpad-tv/protocol';

/**
 * The app URL with the payload as `?__dpad=<base64url(JSON)>`. Existing query parameters and
 * the hash (hash routers) are preserved; an existing `__dpad` parameter is replaced.
 */
export function launchUrl(appUrl: URL, payload: LaunchPayload): string {
  const url = new URL(appUrl);
  url.searchParams.set(LAUNCH_PARAM, encodeLaunchPayloadParam(payload));
  return url.href;
}
