# Asserting requests

Every request that reaches the mock server is recorded, mocked or proxied. Assert on behavior the user can not see: the right call was made, with the right body, once.

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('liking a video posts to the API once', async ({ app }) => {
  await app.launch();
  await app.focus.navigateTo(app.getByTestId('like_button'));
  await app.remote.press(Key.SELECT);

  await expect(app.network).toHaveRequested({ method: 'POST', url: '/v1/likes' });
  const [like] = await app.network.requests({ method: 'POST', url: '/v1/likes' });
  expect(JSON.parse(like!.body!)).toEqual({ videoId: 'v1' });
});
```

Prefer the retrying matcher over reading `requests()` right after an action: the request may still be in flight.

## Filters

`requests({ method, url })`:

- `method` is case-insensitive.
- A string `url` uses the same rules as handler paths: relative paths match any origin, `:params` and `*` work, the query string is ignored.
- A RegExp is tested against the full URL **including** the query string: `{ url: /\/search\?q=news/ }`.

## What a record holds

| Field                  | Notes                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `url`                  | The URL the app meant: original origin + path + query                       |
| `headers`              | As the app sent them, lowercase names                                       |
| `body`, `bodyEncoding` | UTF-8 text, or base64 for binary bodies                                     |
| `mocked`               | `true` when a handler answered, `false` when proxied or failed              |
| `status`               | `null` while in flight or when the connection was dropped                   |
| `error`                | `{ code, message }` when the request failed (see [concepts](./concepts.md)) |
| `response`             | Status, headers and decoded body the app received                           |
| `id`                   | Same value as the `x-dpad-request-id` response header                       |

Bodies above `maxRecordedBodyBytes` (1 MiB) are recorded truncated (`bodyTruncated`) and always forwarded in full.

## HAR

`MockServer.toHar(filter?)` exports the recorded traffic as HAR 1.2 (open it in browser devtools or any HAR viewer). dpad attaches each test's HAR to its report; failed exchanges have `status: 0` or the error status plus `_dpad.error`.

## TV trap

A negative assertion ("never called `/v1/ads`") only proves the app did not call it **through the mock server**. Make sure every client in the app routes through `mockUrl` before relying on absence.
