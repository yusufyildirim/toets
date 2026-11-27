/**
 * `@toets/test`: write one TV E2E test, run it on every platform. Playwright Test with the
 * toets `app` fixture, TV matchers, semantic keys and platform projects.
 */
export { test, type ToetsTestFixtures, type ToetsWorkerFixtures } from './fixtures.js';
export {
  toetsMatchers,
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
  type ToetsConfig,
  type ToetsMockOptions,
  type ToetsOptions,
  type ToetsProjectConfig,
  type ToetsProjectKeys,
  type PlatformProjectOptions,
} from './config.js';
export type { ParityReporterOptions } from './reporter.js';
/** Runtime option types of the `toets` config field (shared with the MCP server). */
export type {
  AppTargetConfig,
  CommandDevicesOptions,
  IdleOptions,
  KeyOverrides,
  MockServerConfig,
  MockServerLike,
  RemoteOptions,
  Timeouts,
} from '@toets/core';
export type { MockServerFactory, RuntimeConfig } from '@toets/core/runner';
export type { SdkHost } from '@toets/protocol';
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
} from '@toets/driver-web';
export type {
  AndroidDeepLink,
  AndroidTvAppConfig,
  AndroidTvDriverOptions,
  AppiumOptions as AndroidTvAppiumOptions,
  LogcatScope as AndroidTvLogcatScope,
  ManagedDeviceOptions as AndroidTvManagedDeviceOptions,
  RemoteProfile as AndroidTvRemoteProfile,
  TestIdAttribute as AndroidTvTestIdAttribute,
  VideoOptions as AndroidTvVideoOptions,
} from '@toets/driver-android-tv';
export type {
  TvosAppConfig,
  TvosDriverOptions,
  TvosManagedDeviceOptions,
} from '@toets/driver-tvos';
export { defineKeyboard, Key, ToetsError } from '@toets/core';
/** Network mocking building blocks for `app.network.use(...)` (from `@toets/mock`, MSW based). */
export { bypass, delay, failure, http, HttpResponse, latency, passthrough } from '@toets/mock';
export type { FailureOptions, HttpHandler, LatencySpec } from '@toets/mock';
export type {
  App,
  Capability,
  DeepLinkMapper,
  Direction,
  DirectionKey,
  ElementTarget as Target,
  Focus,
  Keyboard,
  KeyboardDefinition,
  KeyOverride,
  LaunchOptions,
  Locator,
  Media,
  Network,
  NavigateOptions,
  Platform,
  PlatformEvent,
  PlatformInfo,
  PressUntilFocusedOptions,
  RecordedRequest,
  Remote,
  RequestFilter,
  Screenshot,
  ScreenshotOptions,
  TextEntryOptions,
} from '@toets/core';
