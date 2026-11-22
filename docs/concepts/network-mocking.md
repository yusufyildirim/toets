---
description: Mock API responses with MSW handlers that run on the test host. The app sends traffic to the dpad mock server; unmatched requests pass through to the real backend.
---

# Network mocking

Tests that depend on data mock it. dpad runs [MSW](https://mswjs.io) handlers in a **mock server on the test host**. The app sends its API traffic to that server; matched requests get the handler's response, unmatched ones are proxied to the real backend. Because it is plain HTTP on the host, it works the same on web, emulators and simulators, without certificates.

Turn it on in the config with `dpad: { mock: true }` (the `network.mock` capability):

```ts
import { test, expect, http, HttpResponse } from '@dpad-tv/test';

test('shows an empty state without favorites', async ({ app }) => {
  app.network.use(http.get('*/api/favorites', () => HttpResponse.json([])));
  await app.launch();

  await expect(app.getByTestId('favorites-empty')).toBeVisible();
  await expect(app.network).toHaveRequested({ method: 'GET', url: /\/api\/favorites$/ });
});
```

## How it works

1. Each worker starts a mock server. Its URL reaches the app in the launch payload (`mockUrl`), through the platform's launch channel: a URL parameter on web, an intent extra on Android, launch arguments on tvOS.
2. The app, when it finds `mockUrl`, sends API requests there with the real origin in the `x-dpad-original-origin` header. This is the one cooperation mocking needs from the app: [app integration](../reference/mock/docs/app-integration.md) shows it for fetch and axios.
3. The mock server rebuilds the request as the app meant it (real origin plus path), so handlers match exactly what the real API would see.
4. Handlers added with `app.network.use()` apply to the current test only and reset after it. The most recently added handler wins.
5. Baseline handlers from the config apply to every test, under the per-test ones: `dpad: { mock: { handlers: [...] } }`. `onUnhandledRequest: 'reject'` fails unmatched requests (`MOCK_UNHANDLED`) instead of proxying them, for a hermetic suite.
6. `app.network.requests()` and `expect(app.network).toHaveRequested()` inspect what the app sent, mocked or not. Each test's traffic is attached to the report as `dpad-network.har`.

Without the app-side change, the app keeps talking to its real backend and handlers never see a request. Matching, latency and failure helpers: [writing handlers](../reference/mock/docs/writing-handlers.md).

## Baseline handlers

Responses every test needs (config, auth, feature flags) belong in the config, not in each test:

```ts
// playwright.config.ts
import { defineConfig, http, HttpResponse, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { web: { url: 'http://localhost:8080' } },
  dpad: {
    mock: {
      handlers: [http.get('*/api/config', () => HttpResponse.json({ features: [] }))],
      onUnhandledRequest: 'reject',
    },
  },
  projects: [platforms.web()],
});
```

A test's own `app.network.use()` handlers win over them. A project's `dpad.mock` merges key by key over the top-level one.

## Traps

- **Add handlers before `launch()`** for data the app fetches at startup. Handlers added later only affect later requests.
- **A mock that does nothing** usually means the app never routed the request. Check `app.network.requests()`: an absent request went to the real host directly (native players and image loaders often do).
- **Assert the screen, then the request.** A request assertion proves the app asked; only the screen proves it showed the result.
- **Mock to make tests deterministic**, not to test the backend. Keep a few unmocked smoke tests that exercise real responses.
