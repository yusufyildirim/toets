# Web capabilities

The driver declares only what a browser really delivers. Tests `requires` the rest and are skipped with a reason instead of failing.

| Capability                                                                       | Web driver                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `key.back`, `key.info`, `key.media.*`, `key.color`, `key.numeric`, `key.channel` | yes, while mapped in [`keys`](./keys.md)         |
| `key.home`, `key.menu`                                                           | only if you map them                             |
| `key.longpress`                                                                  | yes (keydown, repeats, keyup)                    |
| `screenshot.element`                                                             | yes (visible part of the element)                |
| `logs`                                                                           | yes (console messages, uncaught errors, crashes) |
| `video`                                                                          | yes (WebM via Playwright screencast)             |
| `focus.graph`, `sync.idle`, `media.state`, `app.state`                           | no: granted by the dpad SDK when the app runs it |
| `platform.events`                                                                | no                                               |

A key capability is declared only when every key behind it is mapped: unmapping `BLUE` removes `key.color`.
