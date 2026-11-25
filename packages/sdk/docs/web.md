---
description: Start the SDK in a web TV app with startToets, and how the web driver delivers the launch payload.
---

# Web adapter

```ts
import { startToets } from '@toets/sdk/web';

startToets(); // first thing in the entry file, before the router rewrites the URL
```

The package is ESM with bare imports: bundle it with the app (any bundler), even for a plain HTML/JS app. Its ES2015 output needs no transpiling.

Bundlers without `package.json` `exports` support (webpack 4, Create React App 3 and 4) cannot find the toets packages. Alias them to the files Node resolves:

```js nocheck
// webpack.config.js (Create React App: through react-app-rewired or craco)
const toets = ['@toets/protocol', '@toets/sdk', '@toets/sdk/web', '@toets/sdk/noop'];
// React Native apps also: '@toets/sdk-react-native', '@toets/sdk-react-native/noop'
module.exports = {
  resolve: {
    alias: Object.fromEntries(toets.map((name) => [`${name}$`, require.resolve(name)])),
  },
};
```

The web driver passes the payload as `?__toets=<base64url>` (also read inside hash routes) or `window.__TOETS__` through an init script.

## What it maps

- **tree:** the DOM from `document.body`. An element becomes a node when it carries meaning (test id, focusable, own text, label, role, state, media, form control); structural wrappers are collapsed. Test ids come from `data-testid` (react-native-web renders `testID` there). Open shadow roots are traversed.
- **focus:** `document.activeElement` and `focusin`/`focusout`; what the app reports with `reportFocus()` once it reports ([focus.md](./focus.md)).
- **sync:** fetch, XHR, short timers, and CSS animations/transitions via `document.getAnimations()` (event fallback on older engines). Infinite animations are ignored.
- **media:** every `<video>`/`<audio>`; id = test id, else element id.
- **logs:** console, `error` and `unhandledrejection`.

## JS focus engines

Many TV web apps move a "focused" class instead of DOM focus. Report every move with `reportFocus(element)`; from the first report on, the adapter ignores DOM focus. See [focus.md](./focus.md).

Options: `testIdAttribute`, `root`, `isFocusable`, `animations: false`, `ignoreAnimation`, `media: false`, plus the runtime options (`idle`, `logs`, `allowRemoteHost`).

## TV trap

TV browsers (Tizen, webOS, old Chromium forks) lack modern APIs. The SDK is built for ES2015 without heavy dependencies, avoids `globalThis` and newer built-ins, and degrades (no `getAnimations()` = event-based animation tracking) instead of failing.
