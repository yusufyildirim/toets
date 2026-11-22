import { API_URL } from '../config';
import { getLaunchPayload, ORIGINAL_ORIGIN_HEADER } from '../dpad';
import { createApiClient, resolveApiRoute } from './client';

export type { ApiClient, ApiRoute } from './client';
export type * from './types';

/** The app-wide API client, routed to the dpad mock server when the launch payload asks for it. */
export const api = createApiClient(
  resolveApiRoute(API_URL, getLaunchPayload()?.mockUrl, ORIGINAL_ORIGIN_HEADER),
);
