# Focus

Focus is what TV tests assert most, so the adapter only reports focus it can trust: native focus, or what a JS focus engine reports.

## Native focus (default)

React Native dispatches `focus`/`blur` for every native view on Android and tvOS, and they bubble through React's event system. `ToetsRoot` listens in the capture phase at the root, so every focus change is seen without touching app components. Out-of-order events (tvOS may deliver the new focus before the old blur) are handled.

Focusable means what the native focus engine uses: `focusable` (Android), `isTVSelectable` (tvOS; set by `focusable` on `View`), Pressables and Touchables by default, and editable text inputs. A `TVFocusGuideView` is not focusable, although react-native-tvos marks its view `isTVSelectable`: it hands focus to its children and is never focused itself. Override with `isFocusable(props, type)`. Focusability is descriptive only (text snapshots); toets never navigates by it.

## JS focus engines

Engines such as react-tv-space-navigation or Norigin Spatial Navigation never move native focus. Report it with `reportFocus()` from the engine's focus callback:

```tsx nocheck
import { reportFocus } from '@toets/sdk-react-native';

function Card({ testID }) {
  const view = useRef(null);
  return (
    <SpatialNavigationFocusableView onFocus={() => reportFocus(view)}>
      <View ref={view} testID={testID} />
    </SpatialNavigationFocusableView>
  );
}
```

`reportFocus` takes a ref, a host instance, a native tag or `null`. The first call switches the session to reported focus; native focus events are ignored from then on. It is the same function as on web: [reporting focus](../../sdk/docs/focus.md) covers the rules and popular engines.

## TV trap

If focus is wrong in reports, check which engine owns it. Mixing a JS engine with native focusable views (both "focused" at once) gives tests two truths; once the app reports focus, toets trusts only the reports.
