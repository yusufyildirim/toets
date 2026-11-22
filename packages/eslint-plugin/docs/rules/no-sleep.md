# no-sleep

Disallows fixed waits in tests and page objects: sleep helpers (`sleep`, `wait`, `pause`, `waitForTimeout`) and raw `setTimeout` / `setInterval`.

## Why

A fixed wait is too long when the app is fast and too short when the device is slow, so it makes suites both slow and flaky. TV targets vary wildly in speed (browser vs emulator vs simulator). dpad assertions retry until their timeout and use the SDK idle signal when present, so waiting for a **state** is always possible.

```ts nocheck
// Bad
await app.remote.press(Key.RIGHT);
await sleep(500);

// Good
await app.remote.press(Key.RIGHT);
await expect(app.getByTestId('rail-0-card-2')).toBeFocused();
```

Not reported: `test.setTimeout(ms)` (test timeout) and MSW's `delay()` inside mock handlers (simulated latency).

## Options

- `functions` (`string[]`): names treated as fixed waits. Default `['sleep', 'wait', 'pause', 'waitForTimeout']`.

```js nocheck
'@dpad-tv/no-sleep': ['error', { functions: ['sleep', 'nap'] }]
```
