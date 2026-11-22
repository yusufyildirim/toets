# Writing a driver

A driver connects dpad to one platform. It is a package whose default export is a `DriverModule`; `@dpad-tv/test` imports it by name only when a project uses it.

```ts
import type { DriverModule } from '@dpad-tv/core';

const module: DriverModule = {
  platform: 'android-tv',
  async createDriver(options, ctx) {
    return new AndroidTvDriver(options, ctx.app, ctx.device);
  },
  createDeviceProvider: (options) => new EmulatorProvider(options), // for `managed` devices
};
export default module;
```

## Contract

- **Small and dumb.** A driver answers `query`, `focused`, `tree`, `press`, `launch`, `screenshot` and declares its `capabilities`. Retries, strictness, matchers, navigation, idle and reporting live in core, so every platform behaves the same.
- **Selector semantics are shared.** Use `evaluateChain` and `matchText` from `@dpad-tv/core` over your snapshots instead of reimplementing them; the first step searches the whole tree, text matches the deepest element, `nth` picks among the current matches.
- **Stable refs.** `ElementSnapshot.ref` must be the same for one element across `query`, `focused` and `tree`, and stay stable while the element is attached. Focus navigation and `focus.current()` compare refs.
- **One coordinate space.** Bounds and `UITree.viewport` share the tree's coordinate space (points, dp or CSS pixels), with the viewport origin at 0,0. The viewport screenshot may be in device pixels; core scales by image width over viewport width when it crops elements and masks.
- **Launch passes the payload** (`sdkUrl`, `token`, `mockUrl`, `state`, `flags`) to the app in the platform's way (URL parameter, intent extra, launch arguments).
- **Devices:** use `DeviceAcquireOptions.parallelIndex` to pick an exclusive device per worker slot.
- **Errors** are `DpadError` with a `hint` and a `docs` slug.

## Testing a driver

`@dpad-tv/core/testing` has `FakeDriver` (a scripted screen with geometry-based focus), `FakeSdkHost` and `FakeMockServer`. Run the core behaviour against the fake, and keep real-device tests for the mapping your driver owns.

## TV trap: focus is not keyboard focus

On Android TV and tvOS the focused element comes from the platform's focus engine, not from accessibility focus. Read the real focus state (`focused` attribute, `hasFocus`), and never move focus with taps or accessibility actions.
