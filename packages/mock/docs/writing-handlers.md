# Writing handlers

Handlers are standard [MSW `http` handlers](https://mswjs.io/docs/api/http). In tests, import the helpers on this page from `@toets/test`, which re-exports them from `@toets/mock` so the server and your handlers share one MSW copy.

```ts run
import { test, expect, http, HttpResponse } from '@toets/test';

test('shows an empty state when there are no rails', async ({ app }) => {
  app.network.use(http.get('/v1/rails', () => HttpResponse.json([])));
  await app.launch();
  await expect(app.getByTestId('rails-empty')).toBeVisible();
});
```

## Matching

- **Relative paths match any origin**: `'/v1/rails'` matches `https://api.tv.example/v1/rails` and the same path on any other host. Most apps talk to one API, so this is the default to reach for.
- **Absolute URLs pin a host**: `'https://api.tv.example/v1/rails'`. Use them when several APIs share paths.
- Params and wildcards follow MSW: `'/v1/items/:id'`, `'*/items'`, RegExp. Query strings never take part in matching; read them from `new URL(request.url).searchParams`.

## Order and lifetime

`use()` prepends. Within one call the first handler wins; across calls the latest call wins. Handlers added in a test are removed after it; baseline handlers from config stay. A resolver that returns nothing falls through to the next handler, then to the upstream.

## Pass-through and real responses

- `passthrough()` sends a matched request to the real API unchanged.
- `fetch(bypass(request))` inside a resolver fetches the real response so you can patch it.

## Latency and failures

Two helpers build handlers for the unhappy path. They work on mocked and proxied traffic alike.

```ts nocheck
import { failure, latency } from '@toets/test';

app.network.use(latency(3000, { url: '/v1/rails' })); // slow, then normal response
app.network.use(failure({ url: '/v1/rails', status: 503, times: 1 })); // fails once, then recovers
app.network.use(failure({ url: '/v1/me' })); // connection dropped (network error)
```

`latency()` only delays requests that reach it: put it before the handlers it should slow down (first in the same `use()` call, or in a later call). `latency('infinite')` never answers, for testing timeouts. Inside your own resolvers use MSW's `delay(ms)`.

## TV trap

Handlers only see traffic the app routes to the mock server. If a mock "does nothing", check `app.network.requests()` first: an absent request means the app called the real host directly. See [app integration](./app-integration.md) and [TV traps](./tv-traps.md).
