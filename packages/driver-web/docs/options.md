# Web driver options

Set in `app.web` or `platforms.web({...})` (platform wins). Invalid values fail fast with `web.invalid-config`.

| Option            | Default                            | Meaning                                                             |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `url`             | required                           | Absolute URL the app is served at.                                  |
| `testIdAttribute` | `data-testid`                      | Attribute read as the element's test ID.                            |
| `keys`            | standard key values                | Per-key overrides, `null` unmaps. See [keys](./keys.md).            |
| `focus`           | DOM focus                          | `{ focused, focusable }` CSS selectors for apps with virtual focus. |
| `launchTransport` | `query`                            | `query` or `initScript`. See [launch payload](./launch.md).         |
| `waitUntil`       | `load`                             | `commit`, `domcontentloaded` or `load`: when `launch()` returns.    |
| `keyRepeat`       | `{ delayMs: 500, intervalMs: 50 }` | Auto-repeat timing while a key is held.                             |
| `page`            | -                                  | Drive this Playwright `Page`.                                       |
| `context`         | -                                  | Open the page in this `BrowserContext`.                             |
| `browser`         | -                                  | Create the context in this `Browser`.                               |
| `launchOptions`   | `{}`                               | Chromium launch options when the driver launches the browser.       |
| `contextOptions`  | `{ viewport: 1920x1080 }`          | Context options when the driver creates the context.                |

`page`, `context` and `browser` are mutually exclusive; see [setup](./setup.md#where-the-page-comes-from).

## Virtual focus

Spatial navigation libraries often never move DOM focus: they mark the focused element with a class. Tell the driver how to see it:

```ts
platforms.web({ focus: { focused: '.is-focused', focusable: '.focusable' } });
```

When several elements match `focused` (e.g. a focused row and its focused card), the last in document order wins, which is the innermost for nested matches.
