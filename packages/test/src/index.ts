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
  type DpadProjectKeys,
  type PlatformProjectOptions,
} from './config.js';
export type { ParityReporterOptions } from './reporter.js';
/** Runtime option types of the `dpad` config field (shared with the MCP server). */
export type {
  AppTargetConfig,
  CommandDevicesOptions,
  IdleOptions,
  KeyOverrides,
  MockServerLike,
  RemoteOptions,
  Timeouts,
} from '@dpad-tv/core';
export type { MockServerFactory, RuntimeConfig } from '@dpad-tv/core/runner';
export type { SdkHost } from '@dpad-tv/protocol';
/*
 * Driver config types. The published declarations inline them, so they work without the
 * (optional) driver packages installed. Generic driver names get a platform prefix.
 */
export type {
  LaunchTransport as WebLaunchTransport,
  LaunchWaitUntil as WebLaunchWaitUntil,
  WebDriverOptions,
  WebKeyMap,
  WebKeySpec,
} from '@dpad-tv/driver-web';
export type {
  AndroidTvAppConfig,
  AndroidTvDriverOptions,
  AppiumOptions as AndroidTvAppiumOptions,
  LogcatScope as AndroidTvLogcatScope,
  ManagedDeviceOptions as AndroidTvManagedDeviceOptions,
  RemoteProfile as AndroidTvRemoteProfile,
  TestIdAttribute as AndroidTvTestIdAttribute,
  VideoOptions as AndroidTvVideoOptions,
} from '@dpad-tv/driver-android-tv';
export type {
  TvosAppConfig,
  TvosDriverOptions,
  TvosManagedDeviceOptions,
} from '@dpad-tv/driver-tvos';
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
