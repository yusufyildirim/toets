# Web driver setup

`@dpad-tv/driver-web` runs web TV apps in Chromium through Playwright. It is the `web` platform of dpad: the runner loads it for `platforms.web()` projects.

## Install

```sh
npm i -D @dpad-tv/test @dpad-tv/driver-web
npx playwright install chromium
```

Chromium only. Firefox and WebKit are not TV engines and are rejected (`web.not-chromium`).

## Configure

The driver needs the URL the app is served at. Everything else has TV defaults (1920x1080 viewport, `data-testid`, standard key values).

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

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

Inside `@dpad-tv/test` the runner passes Playwright Test's handles, so traces, the HTML report and `--headed`/`--debug` keep working. Standalone (scripts, tools), let the driver launch its own browser:

```ts
import { createWebDriver } from '@dpad-tv/driver-web';

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
