# Android TV traps

Where web or phone intuition is wrong on an Android TV emulator.

- **Bounds are clipped.** Android reports the on-screen part of an element. A card half scrolled out of a rail has half its width; a card fully outside is `visible: false` with zero width. Navigate to it (`focus.navigateTo`) instead of asserting on off-screen geometry.
- **Hidden means absent.** `GONE` and `INVISIBLE` views are not in the accessibility tree at all, so a hidden screen yields no elements rather than invisible ones. Visibility assertions still work; hidden elements simply match nothing.
- **React Native flattens plain Views.** In React Native's accessibility tree a plain `View` lists its descendants as its siblings, so `app_root`, the screen and its texts appear side by side. Focusable views, scroll views and `TVFocusGuideView`s keep their children. Locators and container scoping on those work; whole-screen text snapshots do not match the nested SDK tree. Run them with `dpad.sdk`, or snapshot a container that keeps its children.
- **Text is what is rendered.** Transformations apply: a theme with `textAllCaps` turns `Play` into `PLAY`. Assert the rendered text or disable the transformation in the test build.
- **Focus is input focus.** `focused` is Android's input focus, which is the D-pad focus on TV. Accessibility focus (TalkBack) is a different thing and is ignored.
- **The payload arrives once per launch.** dpad force-stops before every launch so the activity is created fresh and `getIntent()` carries `__dpad`. Apps that also handle `onNewIntent` must read it there if they relaunch themselves.
- **`localhost` is the device.** URLs in the payload work only because the driver reverses their ports. Other host URLs need `10.0.2.2` (emulator alias for the host) and will not be reversed.
- **No click, no touch.** TV images have no touchscreen; everything goes through keys. A view that is clickable but not focusable is unreachable on a real TV, and dpad cannot reach it either.
- **Idle is not awaited.** UiAutomator's wait-for-idle is disabled (video and animations can keep a TV screen busy forever). Assertions retry in the core; never sleep.
- **Element refs are positional.** A ref names a position in the last page source; when the screen changes it resolves to nothing (`ANDROID_ELEMENT_DETACHED`). Use locators, which resolve again on every use.
