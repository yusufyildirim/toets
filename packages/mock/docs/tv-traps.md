# Network mocking: TV traps

Where web intuition about request mocking is wrong on TV.

## Media is not API traffic

Video manifests and segments (HLS, DASH) are fetched by native players (ExoPlayer/Media3, AVPlayer) or by MSE inside the player library, not by your API client. Do not route them through the mock server: it adds latency to every segment and records megabytes. Mock the **API response that names the stream** instead, pointing it at a small, stable test stream on a real CDN or a local static server.

## Images bypass your client

Image components load URLs with their own stack and can not add the origin header. Image URLs inside mocked JSON should point at real hosts or a local static server. If an app does rewrite image URLs to `mockUrl`, those requests arrive without the header: they fail with `MOCK_NO_ORIGIN` unless a handler matches them (e.g. `http.get('/images/*', ...)` returning bytes).

## Third-party SDKs are invisible

Analytics, ads, DRM licence servers, crash reporters and player telemetry use their own HTTP clients. They neither route through the mock server nor show up in `requests()`. Stub them at the app's configuration level for tests, or accept that they hit the network.

## Absolute URLs in responses

Pagination links, deep links and redirects often carry absolute URLs to the real host. If the app follows them with a client that does not route, those calls skip the mock. Same-origin redirects are rewritten by the mock server; cross-origin ones are not.

## Cookies are scoped to the real domain

`Set-Cookie: ...; Domain=api.tv.example` is rejected by a web app talking to `localhost`. Token-based auth works unchanged; cookie auth may need a handler that issues host-only cookies in tests.

## Cleartext and transport security

Android blocks cleartext HTTP and tvOS enforces ATS by default, so the first symptom of a missing debug config is "all requests fail" with no record at all. See [app integration](./app-integration.md#platform-setup).

## Timeouts are real

`latency()` above the app's own request timeout produces the app's timeout behavior, not a slow success. TV apps often use long timeouts (30s+); test timeouts with `latency('infinite')` plus a shortened app timeout via launch flags rather than waiting.
