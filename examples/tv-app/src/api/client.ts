import type { Catalog, ItemDetails } from './types';

/** Where API requests go. Built once from the app config and the launch payload. */
export interface ApiRoute {
  /** Base URL requests are sent to (the real API, or the dpad mock server). */
  readonly baseUrl: string;
  /** Extra headers sent with every request. */
  readonly headers: Readonly<Record<string, string>>;
  /** True when traffic is routed to a mock server. */
  readonly mocked: boolean;
}

/**
 * Routes API traffic. Without a mock URL, requests go to `apiUrl` unchanged. With one, the
 * origin is swapped for the mock server's and the real origin travels in `originHeader`, so
 * the mock server can proxy requests it does not handle to the real API.
 */
export function resolveApiRoute(
  apiUrl: string,
  mockUrl: string | undefined,
  originHeader: string,
): ApiRoute {
  const api = new URL(apiUrl);
  const path = trimSlash(api.pathname);
  if (!mockUrl) return { baseUrl: `${api.origin}${path}`, headers: {}, mocked: false };
  const mock = new URL(mockUrl);
  return {
    baseUrl: `${mock.origin}${trimSlash(mock.pathname)}${path}`,
    headers: { [originHeader]: api.origin },
    mocked: true,
  };
}

/** Error for non-2xx responses; `status` is the HTTP status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`Request to ${url} failed with HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiClient {
  readonly route: ApiRoute;
  getCatalog(signal?: AbortSignal): Promise<Catalog>;
  getItem(id: string, signal?: AbortSignal): Promise<ItemDetails>;
}

export function createApiClient(route: ApiRoute, fetchImpl: typeof fetch = fetch): ApiClient {
  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = `${route.baseUrl}${path}`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', ...route.headers },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new ApiError(response.status, url);
    return (await response.json()) as T;
  }

  return {
    route,
    getCatalog: (signal) => get<Catalog>('/api/catalog', signal),
    getItem: (id, signal) => get<ItemDetails>(`/api/items/${encodeURIComponent(id)}`, signal),
  };
}

function trimSlash(path: string): string {
  return path.replace(/\/+$/, '');
}
