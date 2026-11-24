# Focus

Focus is what TV tests assert most, so the adapter only reports focus it can trust.

## Native focus (default)

React Native dispatches `focus`/`blur` for every native view on Android and tvOS, and they bubble through React's event system. `ToetsRoot` listens in the capture phase at the root, so every focus change is seen without touching app components. Out-of-order events (tvOS may deliver the new focus before the old blur) are handled.

Focusable means what the native focus engine uses: `focusable` (Android), `isTVSelectable` (tvOS; set by `focusable` on `View`), Pressables and Touchables by default, and editable text inputs. A `TVFocusGuideView` is not focusable, although react-native-tvos marks its view `isTVSelectable`: it hands focus to its children and is never focused itself. Override with `isFocusable(props, type)`.

## Focus graph

`focus.graph` reports `nextFocusUp/Down/Left/Right` (native tags from `findNodeHandle`) as edges. A view pointing at itself means "focus does not move" (`null`). Everything else is unknown and toets falls back to geometry. `TVFocusGuideView` destinations and `trapFocus*` props are not mapped yet.

## JS focus engines

Engines such as react-tv-space-navigation or Norigin Spatial Navigation never move native focus. Report it instead:

```ts nocheck
startToets({ nativeFocus: false, isFocusable: (props) => props.testID?.startsWith('card-') });

function Card({ testID }) {
  const ref = useRef(null);
  return <SpatialNavigationFocusableView onFocus={() => reportFocus(ref)}>
    <View ref={ref} testID={testID} />
  </SpatialNavigationFocusableView>;
}
```

`reportFocus` takes a ref, a host instance, a native tag or `null`.

## TV trap

If focus is wrong in reports, check which engine owns it. Mixing a JS engine with native focusable views (both "focused" at once) gives tests two truths; pick one source.
