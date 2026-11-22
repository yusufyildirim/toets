# Capabilities

Static capabilities of the tvOS driver. A connected dpad SDK adds its own (`focus.graph`, `sync.idle`, `media.state`, `app.state`, ...).

| Capability                                                                                                     | Supported | How                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| `key.back`, `key.home`, `key.media.toggle`                                                                     | yes       | Siri Remote buttons, see [remote](./remote.md)            |
| `key.longpress`                                                                                                | yes       | `XCUIRemote` press with duration                          |
| `screenshot.element`                                                                                           | yes       | viewport screenshot cropped to the element's frame        |
| `logs`                                                                                                         | yes       | app's unified log (`log stream`), filtered to its process |
| `video`                                                                                                        | yes       | `simctl io recordVideo`, H.264 MP4 in the artifacts dir   |
| `key.menu`, `key.info`, `key.media.discrete`, `key.media.transport`, `key.color`, `key.numeric`, `key.channel` | no        | no such button                                            |
| `network.mock`, `platform.events`                                                                              | no        | not provided by the driver                                |

## Element mapping

One page source fetch (WebDriverAgent JSON) per `query`, `focused` or `tree` call:

| `ElementSnapshot`              | From                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `testId`                       | `accessibilityIdentifier` (never the label fallback XCUITest calls `name`) |
| `label`                        | accessibility label                                                        |
| `text`                         | accessible element: its label; container: own label + children's text      |
| `focused`                      | `hasFocus`, deepest focused element only; ancestors get `focusWithin`      |
| `selected`                     | `Selected` accessibility trait                                             |
| `enabled`, `bounds`, `visible` | XCUITest `isEnabled`, frame (points), `isVisible` + non-zero size          |
| `busy`                         | a visible activity indicator in the subtree                                |
| `focusable`                    | focusable control types, Button/Link traits, or focused now (heuristic)    |

## Latency

Every read is one HTTP round trip to WebDriverAgent plus a snapshot of the accessibility tree, so its cost grows with the number of elements on screen; keep screens lean and avoid reading in tight loops (the core's retry engine already paces reads). A press returns once `XCUIRemote` delivered it; the focus change lands a frame or more later. The integration test prints p50/max per action on your machine:

```sh
DPAD_TVOS_UDID=<udid> pnpm --filter @dpad-tv/driver-tvos test test/integration
```
