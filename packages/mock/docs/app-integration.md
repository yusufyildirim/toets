# App integration

The mock server only sees requests the app sends to it. In test runs the launch payload carries `mockUrl` (e.g. `http://localhost:53124`); the app sends each API request to `mockUrl + path` with the real origin in the `x-dpad-original-origin` header. Without `mockUrl` (production, manual runs) nothing changes.

Rules:

- Keep the path and query; only the origin moves to the header. `https://api.tv.example/v2/rails?page=2` becomes `GET {mockUrl}/v2/rails?page=2` with `x-dpad-original-origin: https://api.tv.example`.
- The header holds an origin only (scheme, host, port), never a path.
- Route every API client (and absolute URLs found in responses, like pagination links) through the same function.
- Read `mockUrl` once at startup from the launch payload. The dpad SDK exposes it; without the SDK, read the `__dpad` launch parameter yourself (web: `?__dpad=` query parameter, Android: intent string extra, tvOS: launch argument) and parse `mockUrl` from the JSON.

## fetch

```ts
declare function getMockUrl(): string | undefined; // from the launch payload

const MOCK_HEADER = 'x-dpad-original-origin';

/** Rewrites a real API URL to the mock server when the launch payload has a mockUrl. */
export function routeRequest(url: string, mockUrl: string | undefined) {
  if (!mockUrl) return { url, headers: {} };
  const real = new URL(url);
  return {
    url: mockUrl + real.pathname + real.search,
    headers: { [MOCK_HEADER]: real.origin },
  };
}

export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const routed = routeRequest(url, getMockUrl()); // getMockUrl(): from the launch payload
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(routed.headers)) headers.set(name, value);
  return fetch(routed.url, { ...init, headers });
}
```

## axios

```ts nocheck
import axios from 'axios';

export const api = axios.create({ baseURL: 'https://api.tv.example/v2' });

api.interceptors.request.use((config) => {
  const mockUrl = getMockUrl();
  if (!mockUrl) return config;
  const real = new URL(api.getUri(config)); // full URL incl. baseURL and params
  config.baseURL = mockUrl;
  config.url = real.pathname + real.search;
  config.params = undefined; // already serialized into real.search
  config.headers.set('x-dpad-original-origin', real.origin);
  return config;
});
```

## Platform setup

- **Android**: cleartext HTTP is blocked by default since Android 9. Allow it for `localhost` in debug builds with a network security config (`<domain includeSubdomains="false">localhost</domain>` with `cleartextTrafficPermitted="true"`). dpad runs `adb reverse` for the mock port, so `localhost` on the device reaches the host.
- **tvOS**: App Transport Security blocks plain HTTP. Set `NSAppTransportSecurity > NSAllowsLocalNetworking = YES` in debug builds. The simulator shares the host network.
- **Web**: nothing to configure. The server answers CORS and Private Network Access preflights; browsers allow `http://localhost` from `https` pages.

## Checking it works

Launch, trigger one API call, then look at `app.network.requests()`. An empty list means the app is not routing; a record with `error.code === 'MOCK_NO_ORIGIN'` means the header is missing.
