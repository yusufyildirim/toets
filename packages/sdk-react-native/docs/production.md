# Production builds

Exclude the SDK from builds that ship: inert code still costs bytes, and on Android any app can start an exported activity with an `__dpad` extra. `@dpad-tv/sdk-react-native/noop` exports the same API doing nothing, so app code keeps calling `startDpad()`, `onState()`, `useDpadMedia()`.

## Metro alias

Include the SDK only when Metro runs for e2e builds:

```js nocheck
// metro.config.js
const { getDefaultConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);
const noop = {
  '@dpad-tv/sdk-react-native': '@dpad-tv/sdk-react-native/noop',
  '@dpad-tv/sdk': '@dpad-tv/sdk/noop',
};
if (process.env.DPAD_E2E !== '1') {
  config.resolver.resolveRequest = (context, moduleName, platform) =>
    context.resolveRequest(context, noop[moduleName] ?? moduleName, platform);
}
module.exports = config;
```

Start Metro (or bundle) with `DPAD_E2E=1` for test builds, and reset the cache when switching (`--reset-cache`). Keep the Android glue behind the same switch (see [react-native.md](./react-native.md)).

## Alternative: e2e entry file

Point test builds at `index.e2e.js`, which calls `startDpad()` and then imports `index.js`; production builds never import the SDK. App code must then not import the SDK directly, or must import it through the no-op alias.
