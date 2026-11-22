import { LAUNCH_PARAM, encodeLaunchPayload, type LaunchPayload } from '@dpad-tv/protocol';

/** The web query-parameter form of a payload: `base64url(JSON)`, unpadded. */
export function encodeWebLaunchParam(payload: LaunchPayload): string {
  return Buffer.from(encodeLaunchPayload(payload), 'utf8').toString('base64url');
}

/**
 * The app URL with the payload as `?__dpad=<base64url(JSON)>`. Existing query parameters and
 * the hash (hash routers) are preserved; an existing `__dpad` parameter is replaced.
 */
export function launchUrl(appUrl: URL, payload: LaunchPayload): string {
  const url = new URL(appUrl);
  url.searchParams.set(LAUNCH_PARAM, encodeWebLaunchParam(payload));
  return url.href;
}
