---
description: Mock API responses with MSW handlers that run on the test host. The app sends traffic to the dpad mock server; unmatched requests pass through to the real backend.
---

# Network mocking

Tests that depend on data mock it. dpad runs [MSW](https://mswjs.io) handlers in a **mock server on the test host**. The app sends its API traffic to that server; matched requests get the handler's response, unmatched ones are proxied to the real backend. Because it is plain HTTP on the host, it works the same on web, emulators and simulators, without certificates.

```ts
import { test, expect } from '@dpad-tv/test';
import { http, HttpResponse } from '@dpad-tv/mock';

test('shows an empty state without favorites', async ({ app }) => {
  app.network.use(http.get('*/api/favorites', () => HttpResponse.json([])));
  await app.launch();

  await expect(app.getByTestId('favorites-empty')).toBeVisible();
  await expect(app.network).toHaveRequested({ method: 'GET', url: /\/api\/favorites$/ });
});
```

## How it works

1. Each worker starts a mock server. Its URL reaches the app in the launch payload (`mockUrl`), through the platform's launch channel: a URL parameter on web, an intent extra on Android, launch arguments on tvOS.
2. The app, when it finds `mockUrl`, sends API requests there and adds a header with the original origin. This is the one cooperation mocking needs from the app; [`@dpad-tv/mock`](../reference/mock.md) documents it for fetch and common clients.
3. Handlers added with `app.network.use()` apply to the current test only and reset after it. The most recently added handler wins.
4. `app.network.requests()` and `expect(app.network).toHaveRequested()` inspect what the app sent, mocked or not.

Without the app-side change, tests still run against the real backend; only mocking is unavailable (`network.mock`).

## Traps

- **Add handlers before `launch()`** for data the app fetches at startup. Handlers added later only affect later requests.
- **Match paths, not hosts.** The app talks to the mock server's host, so write `*/api/favorites` rather than `https://api.example.com/api/favorites`.
- **Assert the screen, then the request.** A request assertion proves the app asked; only the screen proves it showed the result.
- **Mock to make tests deterministic**, not to test the backend. Keep a few unmocked smoke tests that exercise real responses.
