# Web adapter

```ts
import { startDpad } from '@dpad-tv/sdk/web';

startDpad(); // first thing in the entry file, before the router rewrites the URL
```

The web driver passes the payload as `?__dpad=<base64url>` (also read inside hash routes) or `window.__DPAD__` through an init script.

## What it maps

- **tree:** the DOM from `document.body`. An element becomes a node when it carries meaning (test id, focusable, own text, label, role, state, media, form control); structural wrappers are collapsed. Test ids come from `data-testid` (react-native-web renders `testID` there). Open shadow roots are traversed.
- **focus:** `document.activeElement` and `focusin`/`focusout`.
- **sync:** fetch, XHR, short timers, and CSS animations/transitions via `document.getAnimations()` (event fallback on older engines). Infinite animations are ignored.
- **media:** every `<video>`/`<audio>`; id = test id, else element id.
- **logs:** console, `error` and `unhandledrejection`.

## Custom focus engines

Many TV web apps move a "focused" class instead of DOM focus. Tell the adapter:

```ts
startDpad({
  focusedElement: () => document.querySelector('.focused'),
  isFocusable: (el) => el.classList.contains('focusable') || undefined,
  focusNeighbors: (el) => engine.neighbors(el), // { up, down, left, right }: element, null = blocked
});
// and call focusChanged() (from @dpad-tv/sdk/web) when the engine moves focus
```

Other options: `testIdAttribute`, `root`, `animations: false`, `ignoreAnimation`, `media: false`, plus the runtime options (`idle`, `logs`, `allowRemoteHost`).

## TV trap

TV browsers (Tizen, webOS, old Chromium forks) lack modern APIs. The SDK is built for ES2015 without heavy dependencies, avoids `globalThis` and newer built-ins, and degrades (no `getAnimations()` = event-based animation tracking) instead of failing.
