# Network mocking

With `toets: { mock: true }`, a host-side mock server runs per worker. The app learns its address (`mockUrl`) from the launch payload and sends API traffic there; handlers decide what to answer and everything else is proxied upstream. No certificates, no device proxy settings, same on every platform.

```ts nocheck
import { http, HttpResponse } from '@toets/test';

app.network.use(http.get('*/v1/rails', () => HttpResponse.json([])));
await app.launch();
await expect(app.getByTestId('rails-empty')).toBeVisible();
await expect(app.network).toHaveRequested({ method: 'GET', url: '/v1/rails' }, { times: 1 });
```

## Principles

- **Cooperative, not intercepting.** The app must route requests to `mockUrl` when it is present. This is a few lines in the app's HTTP client, and it is what makes mocking portable.
- **Handlers are MSW handlers.** Use them before `launch()` for data the first screen loads.
- **Baseline handlers come from config**: `toets: { mock: { handlers: [...] } }` applies them in every test, below the per-test ones. The other `mock` settings: `onUnhandledRequest` (`proxy` or `reject`), `port`, `maxRecordedBodyBytes`.
- **Isolation:** handlers added in a test and recorded requests are reset between tests; a serial block keeps its handlers.
- **Recorded requests** are attached to the test report and summarized in failure dumps.

## TV trap: requests that bypass the client

Players fetch manifests and segments through native media stacks, and images load through native image loaders. Those requests do not go through the app's HTTP client, so they are not mocked unless the app routes them too.
