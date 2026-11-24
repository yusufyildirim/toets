# Android TV capabilities

What the driver declares black-box (without the in-app SDK). The SDK adds its domains on top.

| Capability                                                                                | Declared            | Notes                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key.back` `key.home` `key.menu` `key.media.toggle` `key.media.seek`                      | yes                 | All remotes.                                                                                                                                                        |
| `key.info` `key.media.discrete` `key.media.track` `key.color` `key.numeric` `key.channel` | `android-tv` remote | Not on the `fire-tv` remote.                                                                                                                                        |
| `key.longpress`                                                                           | yes                 | Exact hold duration with auto-repeat ([keys](./keys.md)).                                                                                                           |
| `screenshot.element`                                                                      | yes                 | Viewport screenshot cropped to the element's on-screen bounds.                                                                                                      |
| `logs`                                                                                    | yes                 | logcat of the app's uid plus system warnings naming the app.                                                                                                        |
| `video`                                                                                   | yes                 | `screenrecord`, H.264 MP4.                                                                                                                                          |
| `network.mock`                                                                            | with `toets.mock`   | Granted by the core when the mock server is on; payload ports are `adb reverse`d, the app must use `mockUrl`.                                                       |
| `platform.events`                                                                         | yes                 | `network-lost`/`-restored`: `svc wifi` and `svc data` off/on (`adb reverse` keeps the host reachable). `suspend`: HOME. `resume`: the app's task back to the front. |
| `tree.hierarchy`                                                                          | no                  | The accessibility tree may flatten containers: React Native lists a plain `View`'s children as its siblings ([traps](./traps.md)). The SDK tree nests.              |
| `sync.idle` `media.state` `app.state`                                                     | no                  | Need the SDK.                                                                                                                                                       |

## Snapshot fields

| `ElementSnapshot`      | From the UiAutomator2 page source                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `testId`               | `resource-id` without `<package>:id/` (React Native `testID` lands here too); none on window decor (`android:id/content` and above) |
| `text`                 | own `text` + text of displayed descendants, whitespace-normalized; hints excluded                                                   |
| `label`                | `content-desc`                                                                                                                      |
| `focused`              | `focused` (input focus, which is the D-pad focus on TV)                                                                             |
| `selected` / `enabled` | same-named attributes                                                                                                               |
| `focusable`            | `focusable`, except containers holding a focusable descendant (scroll views, lists: Android never focuses them then)                |
| `visible`              | `displayed` and non-empty bounds                                                                                                    |
| `inViewport`           | visible and intersecting the screen                                                                                                 |
| `busy`                 | always `false`: Android exposes no busy state; use the SDK `sync` domain                                                            |

`checked` (switches, checkboxes) is not mapped to `selected`; they are different states.
