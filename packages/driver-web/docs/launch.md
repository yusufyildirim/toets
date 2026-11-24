# Launch payload on the web

toets configures the app at launch through one launch payload from `@toets/protocol` (SDK URL, token, mock URL, state, flags). On the web it travels in one of two ways, set by `launchTransport`:

| Transport         | What the app sees                                               |
| ----------------- | --------------------------------------------------------------- |
| `query` (default) | `?__toets=<base64url(JSON)>` on the app URL                     |
| `initScript`      | `window.__TOETS__ = '<base64url(JSON)>'`, before any app script |

Both carry the same value, `encodeLaunchPayloadParam` from `@toets/protocol`; `decodeLaunchPayload` decodes and validates it. The toets SDK reads both, so most apps never touch this.

```js nocheck
// Reading it without the SDK:
const param = new URLSearchParams(location.search).get('__toets') ?? window.__TOETS__;
const json =
  param &&
  new TextDecoder().decode(
    Uint8Array.from(atob(param.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
  );
```

Existing query parameters and hash routes are preserved. Use `initScript` when the app rejects unknown query parameters or rewrites its URL before reading them.

**Trap:** the payload is the only channel. Do not add app-specific query parameters in tests; put app concerns in the payload's `state` and `flags`.
