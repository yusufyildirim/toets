# Web driver options

Set in `app.web` or `platforms.web({...})` (platform wins). Invalid values fail fast with `WEB_INVALID_CONFIG`.

| Option            | Default                              | Meaning                                                                                                        |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `url`             | required                             | Absolute URL the app is served at.                                                                             |
| `testIdAttribute` | `data-testid`                        | Attribute read as the element's test ID.                                                                       |
| `keys`            | standard key values                  | Per-key overrides, `null` unmaps. See [keys](./keys.md).                                                       |
| `launchTransport` | `query`                              | `query` or `initScript`. See [launch payload](./launch.md).                                                    |
| `deepLink`        | host, path, query and hash as a path | `(link: URL) => string`: the page URL or path a deep link loads. See [launch payload](./launch.md#deep-links). |
| `waitUntil`       | `load`                               | `commit`, `domcontentloaded` or `load`: when `launch()` returns.                                               |
| `keyRepeat`       | `{ delayMs: 500, intervalMs: 50 }`   | Auto-repeat timing while a key is held.                                                                        |
| `page`            | -                                    | Drive this Playwright `Page`.                                                                                  |
| `context`         | -                                    | Open the page in this `BrowserContext`.                                                                        |
| `browser`         | -                                    | Create the context in this `Browser`.                                                                          |
| `launchOptions`   | `{}`                                 | Chromium launch options when the driver launches the browser.                                                  |
| `contextOptions`  | `{ viewport: 1920x1080 }`            | Context options when the driver creates the context.                                                           |

`page`, `context` and `browser` are mutually exclusive; see [setup](./setup.md#where-the-page-comes-from).

## Focus

The driver reads DOM focus (`document.activeElement`, through open shadow roots) and nothing else. Apps whose JS focus engine only styles the focused element report focus from the app with the SDK's `reportFocus()` ([reporting focus](../../sdk/docs/focus.md)).
