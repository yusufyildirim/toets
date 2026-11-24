# Web driver setup

`@toets/driver-web` runs web TV apps in Chromium through Playwright. It is the `web` platform of toets: the runner loads it for `platforms.web()` projects.

## Install

```sh
npm i -D @toets/test @toets/driver-web
npx playwright install chromium
```

Chromium only. Firefox and WebKit are not TV engines and are rejected (`WEB_NOT_CHROMIUM`).

## Configure

The driver needs the URL the app is served at. Everything else has TV defaults (1920x1080 viewport, `data-testid`, standard key values).

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: { web: { url: 'http://localhost:3000' } },
  projects: [platforms.web()],
});
```

Options can be set in `app.web` (what the app is) or in `platforms.web({...})` (how this project runs it); the platform wins. See [options](./options.md).

## Where the page comes from

The driver works on exactly one Playwright `Page`, chosen by which handle you pass (at most one):

| Option    | The driver...                                   | Closes on `stop()` |
| --------- | ----------------------------------------------- | ------------------ |
| `page`    | drives that page                                | nothing            |
| `context` | opens a page in that context                    | its page           |
| `browser` | creates a context (`contextOptions`) and a page | its context        |
| none      | launches Chromium (`launchOptions`)             | the browser        |

Inside `@toets/test` the driver launches its own Chromium (set `launchOptions`, e.g. `{ headless: false }`, in `platforms.web({...})`). Playwright Test's `--trace` records it only when both load the same `playwright-core` copy: keep `@playwright/test` and `@toets/driver-web` on the same Playwright version so the package manager dedupes it. Standalone (scripts, tools), the same:

```ts
import { createWebDriver } from '@toets/driver-web';

const driver = createWebDriver({ url: 'http://localhost:3000' });
await driver.start();
await driver.launch({ payload: { v: 1 } });
console.log(await driver.focused());
await driver.stop();
```

## Lifecycle

- `launch` = terminate, then load the URL with the [launch payload](./launch.md). It returns at `waitUntil` (default `load`); waiting for the app to be ready belongs in your launch fixture.
- `terminate` navigates to `about:blank`. Storage survives, like closing a TV app.
- `reset` (and `launch({ clearData: true })`) terminates, then clears cookies and all storage of every origin the app visited. The HTTP cache is kept.
