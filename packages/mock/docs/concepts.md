# Network mocking: concepts

toets mocks HTTP on the **test host**, not inside the app. A small HTTP server (the mock server) runs next to the test runner; the app sends its API traffic there. Handlers are [MSW](https://mswjs.io) request handlers, so they run in Node with your test code and can close over test state.

```
app   GET {mockUrl}/v1/rails
      x-toets-original-origin: https://api.tv.example
mock  handler matches?  yes -> mocked response
                        no  -> proxy GET https://api.tv.example/v1/rails, stream the response back
```

This is a **cooperative proxy**: the app opts in by routing requests to `mockUrl` (from the launch payload) and naming the real origin in the `x-toets-original-origin` header. No MITM certificates, no system proxy, identical on web, Android TV and tvOS. See [app integration](./app-integration.md).

## Request flow

1. CORS preflights are answered directly (permissive, incl. Private Network Access) and not recorded.
2. The request is rebuilt as the app meant it: origin header + path, e.g. `https://api.tv.example/v1/rails`. Handlers and the upstream see exactly what the real API would see (the toets header and hop-by-hop headers removed, `host` set).
3. Handlers run in order; the first one returning a response wins.
4. No response: the request is proxied to the original origin and the response streamed back unchanged (status, headers, compressed bytes). Same-origin redirects are rewritten so they stay on the mock server.
5. Every exchange is recorded: request, response, timing, whether it was mocked, and why it failed.

## Isolation model

- **One mock server per worker**, started once, its URL passed to every launch. Ports are picked by the OS, so workers never collide.
- **Handlers reset per test.** Baseline handlers (`createMockServer({ handlers })`, or `toets: { mock: { handlers } }` in a toets config) always apply; handlers added in a test with `app.network.use()` are removed after it. Recordings are cleared per test too.
- **Hermetic runs**: with `onUnhandledRequest: 'reject'` (in `createMockServer` or `toets.mock`) unmatched requests fail with `MOCK_UNHANDLED` instead of reaching the real API.
- **Concurrency is safe.** Requests are handled in parallel; each one resolves against the handler list as it was when it arrived, so a reset never affects a request in flight.

## Failures are explicit

When the mock server can not do what the app asked, it answers with a JSON body `{ "toetsError": { code, message, hint, docs } }`, an `x-toets-error` header, and records the error on the request:

| Code                        | Status | Meaning                                                       |
| --------------------------- | ------ | ------------------------------------------------------------- |
| `MOCK_NO_ORIGIN`            | 502    | No handler matched and no origin header: nowhere to proxy     |
| `MOCK_UNHANDLED`            | 502    | No handler matched and the server rejects unhandled requests  |
| `MOCK_UPSTREAM_UNREACHABLE` | 502    | Proxying failed (DNS, refused, TLS, ...)                      |
| `MOCK_BAD_ORIGIN`           | 400    | The origin header is not an `http(s)` origin                  |
| `MOCK_HANDLER_ERROR`        | 500    | A handler threw                                               |
| `MOCK_NETWORK_ERROR`        | none   | A handler returned `HttpResponse.error()`; connection dropped |
| `MOCK_RESPONSE_FAILED`      | none   | The body broke after headers were sent                        |

Every response also carries `x-toets-request-id`, matching the recorded request's `id`, to correlate app logs with recordings.

## Not covered

- WebSockets and other protocol upgrades (answered `501`).
- Traffic the app does not route: native players, image loaders, third-party SDKs. See [TV traps](./tv-traps.md).
