# Launch payload on the web

dpad configures the app at launch through one launch payload from `@dpad-tv/protocol` (SDK URL, token, mock URL, state, flags). On the web it travels in one of two ways, set by `launchTransport`:

| Transport         | What the app sees                                                   |
| ----------------- | ------------------------------------------------------------------- |
| `query` (default) | `?__dpad=<base64url(JSON)>` on the app URL                          |
| `initScript`      | `window.__DPAD__` = the JSON string, set before any app script runs |

Both carry the same JSON; `decodeLaunchPayload` from `@dpad-tv/protocol` validates it. The dpad SDK reads both, so most apps never touch this.

```js
// Reading it without the SDK:
const param = new URLSearchParams(location.search).get('__dpad');
const json = param
  ? new TextDecoder().decode(
      Uint8Array.from(atob(param.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    )
  : window.__DPAD__;
```

Existing query parameters and hash routes are preserved. Use `initScript` when the app rejects unknown query parameters or rewrites its URL before reading them.

**Trap:** the payload is the only channel. Do not add app-specific query parameters in tests; put app concerns in the payload's `state` and `flags`.
