import { API_URL } from '../config';
import { getMockUrl, ORIGINAL_ORIGIN_HEADER } from '../toets';
import { createApiClient, resolveApiRoute, type ApiClient } from './client';

export type { ApiClient, ApiRoute } from './client';
export type * from './types';

let client: ApiClient | null = null;

/**
 * Built on first use, not at module load: on Android the toets launch payload (and with it the
 * mock server URL) reaches JS with the first render.
 */
function current(): ApiClient {
  client ??= createApiClient(resolveApiRoute(API_URL, getMockUrl(), ORIGINAL_ORIGIN_HEADER));
  return client;
}

/** The app-wide API client, routed to the toets mock server when the launch payload asks for it. */
export const api: ApiClient = {
  get route() {
    return current().route;
  },
  getCatalog: (signal) => current().getCatalog(signal),
  getItem: (id, signal) => current().getItem(id, signal),
};
