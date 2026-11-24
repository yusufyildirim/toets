# Web capabilities

The driver declares only what a browser really delivers. Tests `requires` the rest and are skipped with a reason instead of failing.

| Capability                                                                       | Web driver                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `key.back`, `key.info`, `key.media.*`, `key.color`, `key.numeric`, `key.channel` | yes, while mapped in [`keys`](./keys.md)                                                                                                                                                   |
| `key.home`, `key.menu`                                                           | only if you map them                                                                                                                                                                       |
| `key.longpress`                                                                  | yes (keydown, repeats, keyup)                                                                                                                                                              |
| `tree.hierarchy`                                                                 | yes (the DOM)                                                                                                                                                                              |
| `screenshot.element`                                                             | yes (visible part of the element)                                                                                                                                                          |
| `logs`                                                                           | yes (console messages, uncaught errors, crashes)                                                                                                                                           |
| `video`                                                                          | yes (WebM via Playwright screencast)                                                                                                                                                       |
| `sync.idle`, `media.state`, `app.state`                                          | no: granted by the toets SDK when the app runs it                                                                                                                                          |
| `platform.events`                                                                | yes: `network-lost`/`network-restored` take the browser context offline; `suspend`/`resume` emulate a backgrounded tab (`visibilitychange` + `freeze`, then `resume` + `visibilitychange`) |

A key capability is declared only when every key behind it is mapped: unmapping `BLUE` removes `key.color`.

**Trap:** offline means offline for everything the page loads, the toets mock server and the SDK connection included. SDK reads fall back to the DOM until `network-restored`; toets restores the network after each test.
