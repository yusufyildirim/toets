# dpad SDK protocol, version 1.0

Normative description of the wire protocol between the dpad test host and an in-app SDK. Types live in `src/messages.ts`; this page defines behavior. "MUST", "SHOULD" and "MAY" are used as in RFC 2119.

The SDK is optional (black-box tests work without it) and is an accelerator: richer trees, focus graph, idle sync, media and app state.

## Transport

- JSON-RPC 2.0 over one WebSocket. One JSON message per text frame. No batches.
- The **app connects to the host**. The host listens on loopback; URLs always use `localhost` (Android drivers `adb reverse` the port, the tvOS simulator and web share the host network).
- The first frame MUST be the `dpad.hello` request. After a successful handshake the host sends requests to the app, the app answers and sends notifications. The app never sends requests after the hello.
- Heartbeat: the host sends WebSocket pings; an app that misses two pongs is closed with code 4003. SDKs MUST let the WebSocket implementation answer pings (all browsers, React Native, OkHttp and URLSession do).
- Coordinates are logical pixels (CSS px, dp, pt) in the app's root coordinate space, origin top-left. `viewport.pixelRatio` maps them to physical pixels (screenshots).

## Launch payload

The single channel through which the host configures an app at launch (`LaunchPayload`):

```json
{
  "v": 1,
  "sdkUrl": "ws://localhost:9323",
  "token": "9f2c...",
  "mockUrl": "http://localhost:9400",
  "state": "logged-in",
  "flags": { "newHome": true }
}
```

| Field     | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `v`       | Payload format version, `1`.                                         |
| `sdkUrl`  | Host WebSocket URL. Absent = black-box run, the SDK stays inert.     |
| `token`   | One-time token for the handshake. Required with `sdkUrl`.            |
| `mockUrl` | Base URL of the mock server the app should send API traffic to.      |
| `state`   | Named app state to launch into (applied through the `state` domain). |
| `flags`   | Feature flags for this launch: string, number or boolean values.     |

Encoding: drivers SHOULD send `base64url(UTF-8 JSON)` without padding (`encodeLaunchPayloadParam`); it survives URLs, shells and `NSUserDefaults` unchanged. SDKs MUST accept base64url (padded or standard base64 too) and plain JSON (`decodeLaunchPayload`). Unknown fields MUST be ignored.

| Platform   | Transport                                                             | SDK reads it from                                      |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| Web        | `?__dpad=<value>` query parameter, or `window.__DPAD__` (init script) | `location.search` / the global                         |
| Android    | Intent string extra `__dpad`                                          | The activity intent (React Native: root initial props) |
| tvOS / iOS | Launch arguments `-__dpad <value>`                                    | `NSUserDefaults` argument domain                       |

Security: an SDK MUST stay inert (install no hooks, open no connection) without a valid payload, and SHOULD refuse an `sdkUrl` whose host is not loopback (`localhost`, `127.0.0.1`, `::1`, Android emulator `10.0.2.2`) unless explicitly configured. Production builds SHOULD exclude the SDK entirely: on Android any app can start an exported activity with extras.

## Handshake

```json nocheck
→ {"jsonrpc":"2.0","id":1,"method":"dpad.hello","params":{"protocol":"1.0.0","token":"9f2c...","sdk":"@dpad-tv/sdk@0.1.0","framework":"web","domains":["tree","focus","sync","media","state","logs"]}}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":"1.0.0","sessionId":"5b0e..."}}
```

The host validates, in order: message shape (first frame is a `dpad.hello` request, else close 4000), params (else InvalidParams + close 4000), token (else Unauthorized + close 4001), protocol (else IncompatibleProtocol with `data.protocol` = host version + close 4002). On rejection the host answers the hello with the error, then closes. The app has 10 s (host default) to send the hello.

Tokens are one-time: a used, unknown or expired token is rejected. A reloaded app (dev reload, crash restart) therefore cannot reconnect; the host relaunches it. SDKs MUST NOT reconnect after a rejection or after the session closes. They MAY retry connecting before the handshake (the host may still be starting); the JS SDKs retry 5 times with backoff.

### Versioning

`PROTOCOL_VERSION` is semver `major.minor.patch`.

- Majors MUST match; otherwise the handshake fails with IncompatibleProtocol.
- A minor adds methods, notifications, fields or domains. The host never calls a method newer than the SDK's announced minor (`METHOD_SINCE`) and treats every field added after 1.0 as optional.
- Both sides MUST ignore unknown fields, unknown notifications and unknown domains.

### Domains

The hello announces implemented domains. The host only calls methods of announced domains; an SDK answers others with DomainUnavailable.

| Domain    | Methods (host → app)       | Notifications (app → host) | Notes                                                        |
| --------- | -------------------------- | -------------------------- | ------------------------------------------------------------ |
| `tree`    | `tree.get`                 |                            |                                                              |
| `focus`   | `focus.get`, `focus.graph` | `focus.changed`            | Requires `tree`. Announce only with a reliable focus source. |
| `sync`    | `sync.waitForIdle`         |                            |                                                              |
| `media`   | `media.get`, `media.list`  | `media.changed`            |                                                              |
| `state`   | `state.apply`              |                            | Plus the payload `state`/`flags` at launch.                  |
| `logs`    |                            | `logs.entry`               |                                                              |
| `metrics` |                            |                            | Reserved; no messages in 1.0.                                |

## Methods

### `tree.get` `{ rootId? } → { root, viewport }`

The UI tree (`ProtocolNode`), or the subtree at `rootId` (NotFound when it no longer exists). Rules:

- `id` is unique in a tree and stable for the lifetime of the underlying element.
- `text` is the node's own text, not its descendants'. `testId`, `label`, `role` are omitted when empty.
- `visible` is false when the node or an ancestor is not rendered (`display: none`, opacity 0, hidden) or has an empty box. It does not mean "inside the viewport"; `bounds` say where it is.
- At most one node has `focused: true`.
- SDKs SHOULD collapse purely structural wrappers so trees stay small.

### `focus.get` `{} → { node }`

The focused node (with its subtree), or `null`.

### `focus.graph` `{ rootId? } → { nodes }`

Focusable nodes and their neighbors per direction. An edge is a node id (focus moves there), `null` (focus does not move: screen edge or trap) or absent (unknown; the host falls back to geometry).

### `sync.waitForIdle` `{ timeoutMs, quietMs? } → { idle, busy }`

Resolves as soon as the app has had no tracked work for `quietMs` (SDK default, about 100 ms), or after `timeoutMs` with `idle: false`. It MUST answer within `timeoutMs` plus a small margin and immediately for `timeoutMs: 0`. `idle: false` MUST name at least one busy resource; `busy` MAY also list recently finished work. Tracked work (decision 16): network, animations, timers shorter than about 1.5 s, focus and navigation transitions, app `markBusy()` marks. Infinite animations and intervals are not tracked. Idle is an accelerator: the host never treats it as a gate.

### `media.get` `{ id? } → { media }` and `media.list` `{} → { media[] }`

Player state (`MediaInfo`). Without `id`, `media.get` answers with the primary player (the most recently active). Unknown ids give `media: null`.

### `state.apply` `{ state?, flags? } → {}`

Runs the app's state handlers and answers when they finish. HandlerFailed when no handler is registered or one throws. The app is busy (for `sync`) while handlers run.

## Notifications

| Notification    | Params                                         | When                                                                      |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `focus.changed` | `{ from, to }` (node ids or `null`)            | Focus moved. Coalesced; never `from === to`.                              |
| `logs.entry`    | `{ level, message, timestamp, kind?, stack? }` | Console output (`kind: console`) and unhandled errors (`kind: uncaught`). |
| `media.changed` | `MediaInfo`                                    | State, rate, duration or error changed (not every position tick).         |

SDKs SHOULD queue notifications until the handshake completes (bounded). The host buffers notifications until the first listener subscribes.

## Errors

| Code   | Name                 | Meaning                                                |
| ------ | -------------------- | ------------------------------------------------------ |
| -32700 | ParseError           | Frame is not JSON.                                     |
| -32600 | InvalidRequest       | Not a JSON-RPC 2.0 request (also: batches).            |
| -32601 | MethodNotFound       | Unknown method.                                        |
| -32602 | InvalidParams        | Bad params.                                            |
| -32603 | InternalError        | Handler crashed.                                       |
| -32001 | Unauthorized         | Token missing, unknown, expired or used.               |
| -32002 | IncompatibleProtocol | Major version mismatch. `data.protocol`: host version. |
| -32003 | DomainUnavailable    | Domain not announced.                                  |
| -32004 | HandlerFailed        | App handler failed or missing (`state.apply`).         |
| -32005 | NotFound             | Referenced node or player does not exist.              |

A malformed frame MUST NOT close the connection: answer with the error (id `null` when unknown) and continue.

### Close codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 1000 | Session over.                                       |
| 1001 | Host shutting down.                                 |
| 4000 | Handshake failed (no valid hello, or none in time). |
| 4001 | Unauthorized token.                                 |
| 4002 | Incompatible protocol.                              |
| 4003 | Unresponsive (missed heartbeats).                   |

## Implementing an SDK

Use `RpcPeer` (JS) or mirror its rules: correlate by id, answer every request exactly once, never throw on bad input. Prove the implementation with the conformance suite ([conformance.md](./conformance.md)).
