---
description: The web platform drives TV web apps in Chromium through Playwright - the fastest loop, with full Playwright traces.
---

# Web

Runs the app in Chromium through Playwright. It is the fastest platform to start and the only one with full Playwright traces, so it is where tests are usually written first. Package: [`@dpad-tv/driver-web`](../reference/driver-web.md).

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { web: { url: 'http://localhost:8080' } },
  projects: [platforms.web()],
});
```

The app must already be served at `url`; start it with Playwright's [`webServer`](https://playwright.dev/docs/test-webserver) option or in your CI job.

| Aspect    | Web                                                                      |
| --------- | ------------------------------------------------------------------------ |
| Test ID   | `data-testid`                                                            |
| Focus     | `document.activeElement`, or the SDK's focus when connected              |
| Keys      | `KeyboardEvent`s; the key mapping is configurable for TV web keycodes    |
| Launch    | navigates to `url` with the launch payload as a `__dpad` query parameter |
| Artifacts | Playwright trace, video, console logs, HAR                               |

## Traps

- **Desktop Chromium is not a TV browser.** It is modern Chromium, not the engine of a given TV OS. Old-engine coverage (Tizen, webOS) is a later phase.
- **Apps that listen to `keyCode`.** Many TV web apps read legacy key codes (for example 461 for back on webOS). Configure the driver's key mapping to match what your app expects; see the driver reference.
- **Virtual focus.** Apps that highlight elements without moving DOM focus need the [SDK](../concepts/sdk.md) for focus assertions to be meaningful.
- **Do not lean on the trace viewer for parity.** Other platforms have step screenshots and text snapshots instead; make failures understandable from those.
