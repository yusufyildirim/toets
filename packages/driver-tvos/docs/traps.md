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
- **Reads never wait.** The driver disables XCUITest's wait-for-idle, so reads return the current state immediately and the core's retries do the waiting. Animations are in flight while you assert; assert on end states.
- **The first run builds WebDriverAgent.** Expect about a minute once per Xcode version; cache it on CI (see [setup](./setup.md)).
- **One simulator per worker.** Focus is global to the device.
