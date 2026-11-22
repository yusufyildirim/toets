/**
 * `@dpad-tv/test`: write one TV E2E test, run it on every platform. Playwright Test with the
 * dpad `app` fixture, TV matchers, semantic keys and platform projects.
 */
export { test, type DpadTestFixtures, type DpadWorkerFixtures } from './fixtures.js';
export {
  dpadMatchers,
  expect,
  type ScreenshotAssertionOptions,
  type TextSnapshotOptions,
  type TimeoutOption,
} from './expect.js';
export { requires } from './requires.js';
export {
  defineConfig,
  platforms,
  type AppTargets,
  type DeviceSelection,
  type DpadConfig,
  type DpadOptions,
  type DpadProjectConfig,
  type PlatformProjectOptions,
} from './config.js';
export type { ParityReporterOptions } from './reporter.js';
export { Key, DpadError } from '@dpad-tv/core';
/** Network mocking building blocks for `app.network.use(...)` (from `@dpad-tv/mock`, MSW based). */
export { delay, failure, http, HttpResponse, latency } from '@dpad-tv/mock';
export type { FailureOptions, HttpHandler, LatencySpec } from '@dpad-tv/mock';
export type {
  App,
  Capability,
  Direction,
  Focus,
  KeyOverride,
  LaunchOptions,
  Locator,
  Media,
  Network,
  NavigateOptions,
  Platform,
  PlatformEvent,
  PlatformInfo,
  RecordedRequest,
  Remote,
  RequestFilter,
  Screenshot,
  ScreenshotOptions,
} from '@dpad-tv/core';
