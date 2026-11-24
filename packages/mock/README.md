# @toets/mock

toets network mocking: MSW handlers served by a host-side mock server with upstream proxying, request recording and HAR export. Works the same on web, Android TV and tvOS without certificates.

Docs (shipped in `docs/`):

- [Concepts](./docs/concepts.md): how requests flow, isolation model, error codes
- [Writing handlers](./docs/writing-handlers.md): matching, order, latency and failure injection
- [Asserting requests](./docs/asserting-requests.md): `requests()` filters, records, HAR
- [App integration](./docs/app-integration.md): routing app traffic to `mockUrl` (fetch, axios), platform setup
- [TV traps](./docs/tv-traps.md): media, images, third-party SDKs, cookies

Project overview: [toets](https://github.com/yusufyildirim/toets#readme).
