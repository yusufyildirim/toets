# Idle sync

With the in-app SDK connected (`sync.idle`), the app reports when it is idle: no pending network, animations, short timers or focus transitions for about 100 ms. Assertions wait for idle before checking, so they check a settled screen and negative assertions resolve quickly.

```ts
// playwright.config.ts
import { defineConfig } from '@toets/test';

export default defineConfig({
  toets: { sdk: true, idle: { quietMs: 100, budgetMs: 2000 } },
  // ...
});
```

## Principles

- **Idle is an accelerator, never a gate.** Every assertion still retries until its timeout. Without the SDK, or when the app never goes idle, toets polls instead. A test never fails only because the app was busy.
- **Busy is reported.** When an assertion fails and the app never became idle within `budgetMs`, the failure names what kept it busy, for example `app never became idle within 2000ms (busy: network GET /api/home); polled instead`.
- **Navigation settles on idle too.** `focus.pressUntilFocused` and `focus.navigateTo` wait for idle (or a short focus poll) between presses.

## TV trap: things that never stop

Autoplaying hero trailers, clocks and polling requests keep an app busy forever. Exclude them as noise in the SDK, or accept that assertions on those screens fall back to polling. Mark long custom work busy with the SDK's `markBusy()` so assertions wait for it.
