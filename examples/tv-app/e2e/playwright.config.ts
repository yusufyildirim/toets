import { defineConfig, platforms, type DeviceSelection } from '@toets/test';

/**
 * One suite, every platform. Build the app first (`pnpm build:web`, `pnpm build:android`,
 * `pnpm build:tvos`), then `pnpm e2e --project=<name>`.
 *
 * - `web`, `android-tv`, `tvos`: with the in-app SDK (idle sync, media state, launch states).
 * - `*-blackbox`: the same tests without the SDK session (decision 5). Tests that need an SDK
 *   capability are skipped with the reason; everything else must pass unchanged.
 *
 * Devices: `TOETS_DEVICES=<address>` (an emulator serial like `emulator-5554`, a simulator UDID)
 * uses already running devices (a lease broker, Android Studio); without it toets boots and
 * manages emulators/simulators itself.
 */
const devices: DeviceSelection = process.env.TOETS_DEVICES ? { mode: 'external' } : 'managed';
const android = { model: 'tv_1080p', osVersion: '33', devices } as const;
// TV browsers autoplay; desktop Chromium blocks playback that no user gesture started.
const web = { use: { launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } } };

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One device per worker: device projects run one worker unless more devices are listed.
  workers: process.env.TOETS_WORKERS ? Number(process.env.TOETS_WORKERS) : 1,
  // Emulators are slower than browsers; assertions still pass as soon as the app is ready.
  expect: { timeout: 10_000 },
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  parityReport: { outputFile: '../toets-report/parity.md' },
  // The API (8091) and the web build (8090). Mocked runs proxy unhandled API calls here. Ready
  // once the API answers (it starts last); native projects need no web build.
  webServer: {
    command: 'node server/main.ts web',
    cwd: '..',
    url: 'http://localhost:8091/api/catalog',
    reuseExistingServer: !process.env.CI,
  },
  app: {
    web: { url: 'http://localhost:8090' },
    androidTV: { apk: '../dist/android/toets-tv-debug.apk', package: 'dev.toets.example' },
    tvOS: { app: '../dist/tvos/toetsTV.app', bundleId: 'dev.toets.example' },
  },
  toets: { sdk: true, mock: true },
  projects: [
    platforms.web(web),
    platforms.androidTV(android),
    platforms.tvOS({ devices }),
    platforms.web({ name: 'web-blackbox', ...web, toets: { sdk: false } }),
    platforms.androidTV({ name: 'android-tv-blackbox', ...android, toets: { sdk: false } }),
  ],
});
