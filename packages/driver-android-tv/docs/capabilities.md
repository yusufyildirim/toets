# Android TV capabilities

What the driver declares black-box (without the in-app SDK). The SDK adds its domains on top.

| Capability                                                                                    | Declared            | Notes                                                          |
| --------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `key.back` `key.home` `key.menu` `key.media.toggle`                                           | yes                 | All remotes.                                                   |
| `key.info` `key.media.discrete` `key.media.transport` `key.color` `key.numeric` `key.channel` | `android-tv` remote | Not on the `fire-tv` remote.                                   |
| `key.longpress`                                                                               | yes                 | Exact hold duration with auto-repeat ([keys](./keys.md)).      |
| `screenshot.element`                                                                          | yes                 | Viewport screenshot cropped to the element's on-screen bounds. |
| `network.mock`                                                                                | yes                 | Payload ports are `adb reverse`d; the app must use `mockUrl`.  |
| `logs`                                                                                        | yes                 | logcat of the app's uid plus system warnings naming the app.   |
| `video`                                                                                       | yes                 | `screenrecord`, H.264 MP4.                                     |
| `focus.graph` `sync.idle` `media.state` `app.state` `platform.events`                         | no                  | Need the SDK.                                                  |

## Snapshot fields

| `ElementSnapshot`                    | From the UiAutomator2 page source                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `testId`                             | `resource-id` without `<package>:id/` (React Native `testID` lands here too)      |
| `text`                               | own `text` + text of displayed descendants, whitespace-normalized; hints excluded |
| `label`                              | `content-desc`                                                                    |
| `focused`                            | `focused` (input focus, which is the D-pad focus on TV)                           |
| `selected` / `enabled` / `focusable` | same-named attributes                                                             |
| `visible`                            | `displayed` and non-empty bounds                                                  |
| `inViewport`                         | visible and intersecting the screen                                               |
| `busy`                               | always `false`: Android exposes no busy state; use the SDK `sync` domain          |

`checked` (switches, checkboxes) is not mapped to `selected`; they are different states.
