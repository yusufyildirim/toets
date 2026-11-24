# Remote buttons and key overrides

The tvOS driver presses real Siri Remote buttons through `XCUIRemote`. It maps only what the remote has:

| toets key                  | Siri Remote button      | Capability         |
| -------------------------- | ----------------------- | ------------------ |
| `UP` `DOWN` `LEFT` `RIGHT` | D-pad / clickpad        | always             |
| `SELECT`                   | Select (clickpad press) | always             |
| `BACK`                     | Menu / Back             | `key.back`         |
| `PLAY_PAUSE`               | Play/Pause              | `key.media.toggle` |
| `HOME`                     | TV / Home               | `key.home`         |

`MENU`, `INFO`, discrete `PLAY`/`PAUSE`/`STOP`, seek (`FAST_FORWARD`, `REWIND`), track (`NEXT`, `PREVIOUS`), color, numeric and channel keys have no button, so tests that need them are skipped on tvOS with a reason. The remote's Menu button is tvOS's back action, which is why it implements `BACK`, not `MENU`.

## Long press

`remote.longPress(key, ms)` holds the button for `ms` (`key.longpress`). On tvOS a long SELECT usually opens a context menu.

## Key overrides

When your app gives a missing key a meaning (say, `FAST_FORWARD` = hold `RIGHT` for 800ms in the player), declare it as a key override in your toets config instead of pressing `RIGHT` in tests. The core performs the override, so the test still reads `remote.press(Key.FAST_FORWARD)`, and reports flag every overridden press. The override format belongs to `@toets/test`; see its config docs. Overrides are app behavior: they live in your config, never in toets.

## Not mapped yet

Newer `XCUIRemote` versions expose buttons of third-party and IR remotes (`pageUp`/`pageDown`, `guide`, and on tvOS 18.1+ `fourColors`, `oneTwoThree`, `tvProvider`). They are not on the Siri Remote and do not map one-to-one to toets keys (one button for all four colors), so v1 leaves them unmapped.
