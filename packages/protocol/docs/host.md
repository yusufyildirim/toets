# SDK host

`createSdkHost()` (from `@dpad-tv/protocol/host`, Node only) is the host side of the [protocol](./spec.md): a loopback WebSocket server that issues one-time tokens and turns each app connection into an `SdkSession`. The dpad core owns one per run; drivers only put its URL and a token into the launch payload.

```ts nocheck
import { createSdkHost } from '@dpad-tv/protocol/host';

const host = await createSdkHost();
const token = host.issueToken();
await driver.launch({ payload: { v: 1, sdkUrl: host.url, token } });
const session = await host.waitForSession(token, { timeoutMs: 15_000 });
if (session.has('tree.get')) {
  const { root } = await session.request('tree.get', {});
}
```

## Behavior

- **Binding:** loopback only by default, `127.0.0.1` and `::1` on the same port, so `localhost` works whichever family the device resolves. `url` is always `ws://localhost:<port>`. Plain HTTP requests get 426.
- **Tokens:** one per launch, 128 bit, expire after 10 minutes unused, valid for exactly one session. Relaunch the app for a new session.
- **`waitForSession`:** resolves on the handshake. On timeout it fails with `sdk.session-timeout` and explains rejections seen meanwhile (wrong token, protocol mismatch), so "the app never connected" and "the app was refused" read differently.
- **`session.has(method)`:** true when the SDK announced the method's domain and its protocol minor is recent enough. Check it before relying on an SDK feature; fall back to black-box behavior otherwise.
- **Requests:** time out after 10 s by default; `sync.waitForIdle` gets its own `timeoutMs` plus 2 s.
- **Notifications:** buffered (500 per method) until the first listener subscribes, so startup logs are not lost.
- **Heartbeat:** pings every 5 s; two missed pongs close the session (code 4003).
- **`close()`:** rejects pending waits and requests with `sdk.host-closed` and closes sessions with 1001.

Options (`SdkHostOptions`): `port`, `host`, `handshakeTimeoutMs`, `requestTimeoutMs`, `heartbeatIntervalMs`, `tokenTtlMs`, `maxPayloadBytes`, `onEvent` (connection, rejection and session events for logs and failure reports).

## Errors

Every failure is a `ProtocolError` with `code`, `hint` and `docs` (same shape as the core's `DpadError`): `sdk.listen-failed`, `sdk.unknown-token`, `sdk.session-timeout`, `sdk.host-closed`, `sdk.closed`, `sdk.request-timeout`, `sdk.method-unsupported`, `sdk.remote-error` (`rpcCode` and `data` carry the SDK's JSON-RPC error).

## TV trap

A dev reload of the app (Metro `r`, browser refresh) produces a new JS context that presents the already used token and is refused (`Token already used`). That is by design: a test must relaunch the app, not reload it, to get a fresh session.
