# Production builds

The SDK is inert without a launch payload, but it must not ship in production: an inert SDK still costs bytes, and on Android any app can start an exported activity with an `__dpad` extra. Exclude it at build time.

## Alias to the no-op module

`@dpad-tv/sdk/noop` (and `@dpad-tv/sdk-react-native/noop`) export the same app-facing API doing nothing, so app calls like `markBusy()` and `onState()` stay in place.

```js
// vite.config.js
export default defineConfig(({ mode }) => ({
  resolve: {
    alias:
      mode === 'e2e' ? [] : [{ find: /^@dpad-tv\/sdk(\/web)?$/, replacement: '@dpad-tv/sdk/noop' }],
  },
}));
```

Webpack: `resolve.alias` the same way. Metro: see the React Native adapter's `production.md`.

## Or keep it out of the entry

Start the SDK from an e2e-only entry file (`index.e2e.js` importing the SDK, then the app) and build test builds from that entry. App code then imports only from the no-op-safe API, or not at all.

## TV trap

Store builds are often the builds QA tests last. Test the build flavor that will ship (with the SDK aliased away) black-box at least once per release.
