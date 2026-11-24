---
description: Principles for running toets in CI - one job per platform host, build once, size workers to devices, cache the slow parts, always keep the report.
---

# CI recipes

toets ships no CI actions: these pages are recipes to adapt to your provider. The examples use GitHub Actions because it is common; the principles carry over.

## Principles

- **One job per platform host.** Web runs anywhere, Android TV needs Linux with KVM (or macOS), tvOS needs macOS. Split by `--project`.
- **Build the app once.** Build the web bundle, APK and simulator `.app` in their own jobs, pass them as artifacts, and point the `app` config at them.
- **Size workers to devices.** Each worker leases one emulator or simulator. An Android TV emulator wants about 2 vCPUs and 3 GB of RAM; set `workers` to what the runner can host and shard across jobs for more.
- **Cache what is slow and deterministic.** System images, AVD snapshots, WebDriverAgent, browsers. See [Caching](./caching.md).
- **Always keep the report**, especially when the job fails. See [Artifacts and reports](./artifacts.md).
- **Retries are a signal, not a fix.** Allow at most one retry in CI, and treat tests the report marks flaky as bugs.

```ts
import { defineConfig, platforms } from '@toets/test';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  retries: ci ? 1 : 0,
  workers: ci ? 2 : '50%',
  reporter: ci ? [['blob'], ['github']] : 'html',
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' },
    tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV({ osVersion: '34' }),
    platforms.tvOS({ osVersion: '18' }),
  ],
});
```

## Recipes

- [Android TV on Linux](./android.md)
- [tvOS on macOS](./tvos.md)
- [Caching](./caching.md)
- [Artifacts and reports](./artifacts.md)

The web project needs nothing beyond `npx playwright install --with-deps chromium` and your app served at the configured URL.
