# Production builds

Exclude the SDK from builds that ship: inert code still costs bytes, and on Android any app can start an exported activity with an `__toets` extra. `@toets/sdk-react-native/noop` exports the same API doing nothing, so app code keeps calling `startToets()`, `onState()`, `useToetsMedia()`.

## Metro alias

Include the SDK only when Metro runs for e2e builds:

```js nocheck
// metro.config.js
const { getDefaultConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);
const noop = {
  '@toets/sdk-react-native': '@toets/sdk-react-native/noop',
  '@toets/sdk': '@toets/sdk/noop',
};
if (process.env.TOETS_E2E !== '1') {
  config.resolver.resolveRequest = (context, moduleName, platform) =>
    context.resolveRequest(context, noop[moduleName] ?? moduleName, platform);
}
module.exports = config;
```

Start Metro (or bundle) with `TOETS_E2E=1` for test builds, and reset the cache when switching (`--reset-cache`). Keep the Android glue behind the same switch (see [react-native.md](./react-native.md)).

## Webpack alias (react-native-web)

The same switch for web builds bundled by webpack; with Create React App, apply it through `react-app-rewired` or `craco`:

```js nocheck
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      ...(process.env.TOETS_E2E === '1'
        ? {}
        : {
            '@toets/sdk-react-native$': require.resolve('@toets/sdk-react-native/noop'),
            '@toets/sdk$': require.resolve('@toets/sdk/noop'),
          }),
    },
  },
};
```

`$` matches the exact module name, so subpaths such as `@toets/sdk/web` are left alone. On webpack 4, add these after the aliases for bundlers without `exports` support ([web adapter](../../sdk/docs/web.md)) so they win.

## Alternative: e2e entry file

Point test builds at `index.e2e.js`, which calls `startToets()` and then imports `index.js`; production builds never import the SDK. App code must then not import the SDK directly, or must import it through the no-op alias.
