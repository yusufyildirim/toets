# Capabilities

Static capabilities of the tvOS driver. A connected toets SDK adds its own (`sync.idle`, `media.state`, `app.state`, ...).

| Capability                                                                                                                   | Supported | How                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `key.back`, `key.home`, `key.media.toggle`                                                                                   | yes       | Siri Remote buttons, see [remote](./remote.md)                                                                                           |
| `key.longpress`                                                                                                              | yes       | `XCUIRemote` press with duration                                                                                                         |
| `screenshot.element`                                                                                                         | yes       | viewport screenshot cropped to the element's frame                                                                                       |
| `logs`                                                                                                                       | yes       | app's unified log (`log stream`), filtered to its process                                                                                |
| `video`                                                                                                                      | yes       | `simctl io recordVideo`, H.264 MP4 in the artifacts dir                                                                                  |
| `key.menu`, `key.info`, `key.media.discrete`, `key.media.seek`, `key.media.track`, `key.color`, `key.numeric`, `key.channel` | no        | no such button                                                                                                                           |
| `platform.events`                                                                                                            | no        | not provided by the driver                                                                                                               |
| `text.input`                                                                                                                 | yes       | XCUITest `typeText` into the focused text field (`\b` erases, `\n` submits); `fill` closes the fullscreen keyboard it opened with `Menu` |
| `tree.hierarchy`                                                                                                             | no        | XCUITest flattens plain containers (below); the SDK tree nests                                                                           |
| `network.mock`                                                                                                               | core      | granted by the core when `toets.mock` is on (the simulator shares the host network)                                                      |

## Element mapping

One page source fetch (WebDriverAgent JSON) per `query`, `focused` or `tree` call:

| `ElementSnapshot`              | From                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `testId`                       | `accessibilityIdentifier` (never the label fallback XCUITest calls `name`)                                                    |
| `label`                        | accessibility label                                                                                                           |
| `text`                         | accessible element or `StaticText`: its label; others: own label + children's text, without repeating the own label           |
| `focused`                      | `hasFocus`, deepest focused element only; ancestors get `focusWithin`                                                         |
| `selected`                     | `Selected` accessibility trait                                                                                                |
| `enabled`, `bounds`, `visible` | XCUITest `isEnabled`, frame (points), `isVisible` + non-zero size; flattened views (below): non-zero size inside the viewport |
| `busy`                         | a visible activity indicator in the subtree                                                                                   |
| `focusable`                    | focusable control types, Button/Link traits, accessible `Other` views (React Native touchables), or focused now (heuristic)   |

XCUITest flattens a React Native view that has a `testID` but is not accessible (a screen, a rail) into a childless `Other` element, and reports it invisible. toets treats it as visible when it has a size and lies in the viewport, but its children are siblings elsewhere in the tree: scoping a locator into it or `toHaveFocusWithin` on it only works with the toets SDK connected.

## Latency

Every read is one HTTP round trip to WebDriverAgent plus a snapshot of the accessibility tree, so its cost grows with the number of elements on screen; keep screens lean and avoid reading in tight loops (the core's retry engine already paces reads). A press returns once `XCUIRemote` delivered it; the focus change lands a frame or more later.

Measured on an Apple Silicon Mac, Xcode 27.2, Apple TV 4K (3rd generation) (at 1080p) simulator, tvOS 27.2, prebuilt WebDriverAgent cached:

| Action                                    | p50       | p90    |
| ----------------------------------------- | --------- | ------ |
| `query` / `focused` / `tree`, 29 elements | ~110ms    | ~150ms |
| `query` / `focused` / `tree`, 95 elements | ~255ms    | ~260ms |
| `press`                                   | ~235ms    |        |
| `press` with `holdMs: 1500`               | ~1.73s    |        |
| `screenshot`                              | ~60-120ms |        |
| element screenshot                        | ~165ms    |        |
| `launch` (terminate + launch)             | ~1.45s    |        |
| `terminate`                               | ~1.1s     |        |
| `reset` (app not running)                 | ~15ms     |        |
| `start` (booted simulator)                | ~4.2s     |        |

29 elements is the Swift fixture app, 95 the React Native example's home screen. A `press` is one `XCUIRemote` press, ~235ms whatever its duration. The integration test prints p50/p90/max per action on your machine:

```sh
TOETS_TVOS_UDID=<udid> pnpm --filter @toets/driver-tvos test test/integration
```

The full stack (`@toets/test` on the fixture app) runs with `TOETS_TVOS_UDID=<udid>` (external) or `TOETS_TVOS_MANAGED=1` (managed provider):

```sh
TOETS_TVOS_MANAGED=1 pnpm --filter @toets/test exec vitest run test/tvos.test.ts
```
