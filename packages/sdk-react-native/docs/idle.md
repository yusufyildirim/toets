# Idle in React Native

General rules: `@dpad-tv/sdk` docs, `idle.md`. What the adapter adds:

| Source               | Tracking                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Network              | XHR only: React Native's `fetch` runs on XHR, counting both would double up.                                                |
| `Animated`           | `timing`/`spring`/`decay` from `start()` to the end callback (JS and native driver). Infinite `Animated.loop`s are ignored. |
| `LayoutAnimation`    | Covered through its internal completion timer.                                                                              |
| `InteractionManager` | Handles count as busy on React Native versions that still ship it.                                                          |
| Navigation           | `navigationIdleListeners()` for React Navigation stacks (below).                                                            |

```tsx
<Stack.Navigator screenListeners={navigationIdleListeners()}>
```

## Not visible to the SDK

Wrap these in `markBusy()` or accept polling: Reanimated worklets (UI thread), native image decoding, video startup, native modules doing async work, `requestAnimationFrame` loops.

## TV trap

Focus animations (scale on focus, parallax) are usually `Animated` or Reanimated. `Animated` ones are tracked, so a press waits for the focus animation to finish; Reanimated ones are not, and screenshots taken right after a press may catch them mid-flight.
