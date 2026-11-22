# Network mocking

With `dpad: { mock: true }`, a host-side mock server runs per worker. The app learns its address (`mockUrl`) from the launch payload and sends API traffic there; handlers decide what to answer and everything else is proxied upstream. No certificates, no device proxy settings, same on every platform.

```ts
import { http, HttpResponse } from 'msw';

app.network.use(http.get('*/api/home', () => HttpResponse.json({ rails: [] })));
await app.launch();
await expect(app.getByTestId('empty_state')).toBeVisible();
await expect(app.network).toHaveRequested({ method: 'GET', url: '/api/home' }, { times: 1 });
```

## Principles

- **Cooperative, not intercepting.** The app must route requests to `mockUrl` when it is present. This is a few lines in the app's HTTP client, and it is what makes mocking portable.
- **Handlers are MSW handlers.** Use them before `launch()` for data the first screen loads.
- **Isolation:** handlers and recorded requests are reset between tests; a serial block keeps its handlers.
- **Recorded requests** are attached to the test report and summarized in failure dumps.

## TV trap: requests that bypass the client

Players fetch manifests and segments through native media stacks, and images load through native image loaders. Those requests do not go through the app's HTTP client, so they are not mocked unless the app routes them too.
