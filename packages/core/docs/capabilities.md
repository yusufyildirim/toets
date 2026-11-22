# Capabilities

A capability is something a target can do: press color keys (`key.color`), report media state (`media.state`), mock the network (`network.mock`). The available set is the driver's capabilities, plus the SDK's when the app embeds it, plus `network.mock` when mocking is on.

```ts
test('the guide opens with the green key', requires('key.color'), async ({ app }) => {
  await app.launch();
  await app.remote.press(Key.GREEN);
  await expect(app.getByTestId('guide')).toBeVisible();
});

if (app.platform.has('media.state')) {
  /* optional extra checks */
}
```

## Principles

- **Declare, do not branch.** `requires(...)` skips the test with a reason on platforms without the capability, and the parity report shows where and why. A test that branches on `app.platform.name` hides gaps.
- **Using a missing capability fails loudly** with `CAPABILITY_MISSING` or `KEY_UNSUPPORTED`, naming the capability and how to declare it.
- **SDK capabilities** (`focus.graph`, `sync.idle`, `media.state`, `app.state`, `logs`) count as available for `requires` when the SDK is configured, because the app connects only at launch.

## TV trap: same key, different remotes

Android TV remotes vary by vendor; the Siri Remote has no color, numeric or channel keys. A suite that passes on one remote can be untestable on another. Capabilities make that visible instead of turning it into failures.
