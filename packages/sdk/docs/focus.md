---
description: Apps whose JS focus engine keeps focus in app state report it with reportFocus(); one call on every platform.
---

# Reporting focus

toets reads focus black-box when the platform's focus engine owns it: DOM focus on web, native focus on Android TV and tvOS. A **JS focus engine** (Norigin Spatial Navigation, LRUD, react-tv-space-navigation, a home-grown one) keeps focus in app state and only styles the focused element. Nothing outside the app can see it, so the app reports it:

```ts
import { reportFocus } from '@toets/sdk';

/** The app's focus engine: moves a class, never DOM focus, and tells toets. */
export function focusTile(tile: HTMLElement): void {
  document.querySelector('.focused')?.classList.remove('focused');
  tile.classList.add('focused');
  reportFocus(tile);
}
```

`reportFocus(target)` is the same function on every platform (`@toets/sdk`, `@toets/sdk/web`, `@toets/sdk-react-native` all export it). It takes what the app already holds:

| Platform                     | `target`                                   |
| ---------------------------- | ------------------------------------------ |
| Web, react-native-web        | a DOM element, or a ref object holding one |
| React Native (tvOS, Android) | a ref, a host instance, a native tag       |
| Everywhere                   | `null`: nothing is focused                 |

## Rules

- **Report every move**, from the engine's focus callback or event, including the initial focus.
- **One source of truth.** The first call switches the session to reported focus: from then on toets ignores DOM and native focus. Report from one place, the engine.
- **Report the element, not a guess of where focus goes next.** toets presses keys through the platform and reads focus again; it never asks the app for a focus graph.
- **Safe everywhere.** Inert without a toets launch payload, and callable before the SDK starts (React Native on Android starts it with the root view; earlier reports are replayed). The production no-op module exports it too ([production.md](./production.md)).

## With popular engines

toets has no library-specific code: hook `reportFocus` into the engine's focus callback. Sketches against the libraries' public APIs:

**Norigin Spatial Navigation** has no global focus event; each `useFocusable` gets `onFocus`. A shared focusable component reports for all:

```tsx nocheck
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { reportFocus } from '@toets/sdk';

function Focusable({ children, testId }) {
  const { ref, focused } = useFocusable({ onFocus: () => reportFocus(ref) });
  return (
    <div ref={ref} data-testid={testId} className={focused ? 'focused' : ''}>
      {children}
    </div>
  );
}
```

The same works with its React Native package (`@noriginmedia/norigin-spatial-navigation-react-native-tvos`), with `ref` on a `View`.

**LRUD** (`lrud`) emits `focus` with its node; nodes are ids the app maps to elements:

```ts nocheck
import { Lrud } from 'lrud';
import { reportFocus } from '@toets/sdk';

const navigation = new Lrud();
navigation.on('focus', (node) => reportFocus(document.getElementById(node.id)));
```

**react-tv-space-navigation** (React Native) calls `onFocus` without arguments, and the `SpatialNavigationFocusableView` ref is not a view. Report a view inside it:

```tsx nocheck
import { useRef } from 'react';
import { View } from 'react-native';
import { SpatialNavigationFocusableView } from 'react-tv-space-navigation';
import { reportFocus } from '@toets/sdk-react-native';

function Card({ testID, title }) {
  const view = useRef(null);
  return (
    <SpatialNavigationFocusableView onFocus={() => reportFocus(view)}>
      {({ isFocused }) => (
        <View ref={view} testID={testID}>
          <Title focused={isFocused}>{title}</Title>
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}
```

## TV trap

Two focus engines at once (a JS engine plus natively focusable views) give tests two truths. Once the app reports, toets trusts only the reports: a view that steals native focus no longer counts, so a mismatch shows up as a failed focus assertion instead of a flaky one.
