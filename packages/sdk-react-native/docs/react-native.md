# React Native integration

`@toets/sdk-react-native` targets react-native-tvos (Android TV, Fire TV, tvOS) on the new architecture, and react-native-web. It builds on `@toets/sdk`: the app-facing API (`onState`, `markBusy`, `getLaunchPayload`, ...) is re-exported, see that package's docs.

## Setup

```ts nocheck
// index.js
import { startToets } from '@toets/sdk-react-native';
startToets(); // first: before the app's modules run

import { AppRegistry } from 'react-native';
import App from './App';
AppRegistry.registerComponent('app', () => App);
```

`startToets()` is inert without a launch payload. When active it installs `ToetsRoot` around the app (`AppRegistry.setWrapperComponentProvider`). If the app registers its own wrapper provider, pass `wrapRoot: false` and register `withToets(App)` instead.

The payload reaches JS differently per platform:

| Platform           | Native glue | How                                                                           |
| ------------------ | ----------- | ----------------------------------------------------------------------------- |
| tvOS / iOS         | none        | `-__toets <value>` launch argument, read through `Settings` (NSUserDefaults). |
| Android TV/Fire TV | 5 lines     | Intent extra handed to the root as the `__toets` initial prop (below).        |
| react-native-web   | none        | `?__toets=` query parameter; the web adapter takes over.                      |

### Android glue

```kotlin
// MainActivity.kt
override fun createReactActivityDelegate(): ReactActivityDelegate =
  object : DefaultReactActivityDelegate(this, mainComponentName) {
    // toets: pass the launch payload (intent extra) to JS. Test builds only.
    override fun getLaunchOptions(): Bundle? =
      this@MainActivity.intent?.getStringExtra("__toets")
        ?.takeIf { BuildConfig.DEBUG }
        ?.let { Bundle().apply { putString("__toets", it) } }
  }
```

Gate it the way your test builds are built (`BuildConfig.DEBUG`, a flavor or a `buildConfigField`). On Android the payload arrives when `ToetsRoot` first renders, so read `getToets()` and `getLaunchPayload()` inside components or lazily (an API client resolving its base URL on first request), not at module load.

## What it maps

- **tree:** React's committed host views (`RCTView`, `RCTText`, inputs, ...). A view becomes a node when it carries meaning: `testID`, focusable, text, `accessibilityLabel`/`aria-label`, `role`/`accessibilityRole`, `accessibilityState`/`aria-*` (selected, checked, disabled, busy). Wrappers are collapsed. `<Text>` text is concatenated (nested `<Text>` included); inputs report their value (never for `secureTextEntry`) and use the placeholder as label. Hidden: `display: 'none'`, opacity 0, hidden `<Activity>`/Suspense content. Bounds come from synchronous layout (`getBoundingClientRect`), in window coordinates.
- **focus:** native focus events ([focus.md](./focus.md)).
- **sync:** XHR (React Native's `fetch` is built on it), short timers, `Animated`, navigation ([idle.md](./idle.md)).
- **media:** react-native-video through `useToetsMedia` ([media.md](./media.md)).
- **logs:** console and uncaught JS errors (`ErrorUtils`).

Options: `testIdProp`, `isFocusable`, `nativeFocus`, `animated`, `wrapRoot`, `web` (web adapter options), plus the runtime options (`idle`, `logs`, `allowRemoteHost`).

See also [production.md](./production.md) and [traps.md](./traps.md).
