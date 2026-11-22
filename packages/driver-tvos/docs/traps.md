# tvOS traps

Where web or mobile intuition is wrong on tvOS.

- **No click, no tap.** There is no pointer. Move focus with the D-pad, act with `SELECT`. `focus.navigateTo` finds the presses for you.
- **testId is `accessibilityIdentifier`.** Set it with `.accessibilityIdentifier("x")` (SwiftUI), `accessibilityIdentifier` (UIKit) or `testID` (React Native). XCUITest's `name` falls back to the label; dpad deliberately ignores that fallback.
- **SwiftUI identifiers leak into children.** An identifier on a stack is applied to every child. Add `.accessibilityElement(children: .contain)` to the container first.
- **Text belongs to the deepest element.** `getByText('Play')` can resolve to the `StaticText` inside a button, which is never focused. Assert focus on a testId, not on text.
- **Accessible elements speak for their subtree.** A button's `text` is its accessibility label; if the label differs from what is drawn, assertions see the label.
- **`BACK` at the root leaves the app.** The Menu button on a root screen sends the app to the background, like a user would.
- **`focusable` is inferred.** XCUITest has no focusable flag; custom `.focusable()` views count once they hold focus or carry the Button trait.
- **Refs follow the screen structure.** Element refs are tree paths; after the screen changes, re-resolve the locator (the core does this for you).
- **Presses during a screen transition are dropped.** For about 350ms after a push or pop nothing has focus and the focus engine ignores the remote, although the new screen is already in the tree. The driver waits for focus before each press (`focusWaitMs`), so a test can press right after asserting on the new screen. A screen that never focuses anything costs that wait per press.
- **Down only reaches what is below.** The focus engine moves to elements that overlap the focused one along the movement axis. A button at the far left is unreachable with `DOWN` from a card on the right; on web and Android TV spatial navigation often reaches it.
- **React Native joins texts into labels.** An accessible view (a touchable card, a switch row) gets its children's texts joined with `, ` as its label, e.g. `Northern Lights, 2025 · Drama` or `Autoplay, Start playback automatically, On`. Use `toContainText`, or assert on the testId of the text itself.
- **React Native plain views lose their children.** XCUITest flattens a non-accessible view with a `testID` (a screen, a rail) into an empty element; its children appear as its siblings. Scoping into it and `toHaveFocusWithin` on it need the dpad SDK; without it, assert on the focused element's testId.
- **Offscreen list items are there but invisible.** A `FlatList` keeps cards outside the viewport in the tree with `visible: false`; `toBeVisible` on them fails until focus scrolls them in.
- **Reads never wait.** The driver disables XCUITest's wait-for-idle, so reads return the current state immediately and the core's retries do the waiting. Animations are in flight while you assert; assert on end states.
- **The first run builds WebDriverAgent.** Expect about a minute once per Xcode version; cache it on CI (see [setup](./setup.md)).
- **One simulator per worker.** Focus is global to the device.
