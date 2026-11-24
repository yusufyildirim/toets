---
description: The web platform drives TV web apps in Chromium through Playwright - the fastest loop, with full Playwright traces.
---

# Web

Runs the app in Chromium through Playwright. It is the fastest platform to start and the only one with full Playwright traces, so it is where tests are usually written first. Package: [`@toets/driver-web`](../reference/driver-web.md).

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: { web: { url: 'http://localhost:8080' } },
  projects: [platforms.web()],
});
```

The app must already be served at `url`; start it with Playwright's [`webServer`](https://playwright.dev/docs/test-webserver) option or in your CI job.

| Aspect    | Web                                                                       |
| --------- | ------------------------------------------------------------------------- |
| Test ID   | `data-testid`                                                             |
| Focus     | `document.activeElement`, or the SDK's focus when connected               |
| Keys      | `KeyboardEvent`s; the key mapping is configurable for TV web keycodes     |
| Launch    | navigates to `url` with the launch payload as a `__toets` query parameter |
| Artifacts | Playwright trace (`--trace on`), video, console logs                      |

Options (test ID attribute, key map, virtual focus, viewport, launch transport): [web driver options](../reference/driver-web/docs/options.md).

## Traps

- **Desktop Chromium is not a TV browser.** It is modern Chromium, not the engine of a given TV OS. Old-engine coverage (Tizen, webOS) is a later phase.
- **Apps that listen to `keyCode`.** Many TV web apps read legacy key codes (for example 461 for back on webOS). Configure the driver's [key map](../reference/driver-web/docs/keys.md) to match what your app expects.
- **Virtual focus.** Apps that highlight elements without moving DOM focus need the driver's [`focus` selectors](../reference/driver-web/docs/options.md#virtual-focus) or the [SDK](../concepts/sdk.md) for focus assertions to be meaningful.
- **Do not lean on the trace viewer for parity.** Other platforms have step screenshots and text snapshots instead; make failures understandable from those.
