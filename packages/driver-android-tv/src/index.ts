/**
 * dpad driver for Android TV / Fire TV emulators on Appium UiAutomator2.
 *
 * The default export is the {@link DriverModule} `@dpad-tv/test` loads for `android-tv`
 * projects. Named exports are building blocks for custom device providers and tools.
 *
 * @packageDocumentation
 */
import type { DriverModule } from '@dpad-tv/core';
import { createAndroidTvDriver } from './driver.js';
import { ManagedDeviceProvider } from './devices/managed.js';
import type { AndroidTvDriverOptions } from './options.js';

const androidTv: DriverModule<AndroidTvDriverOptions> = {
  platform: 'android-tv',
  async createDriver(options, ctx) {
    return createAndroidTvDriver(options, ctx);
  },
  createDeviceProvider(options) {
    return new ManagedDeviceProvider(options.managed, options.sdkRoot);
  },
};

export default androidTv;

export {
  AndroidTvDriver,
  createAndroidTvDriver,
  DEFAULT_UIA2_SETTINGS,
  payloadPorts,
  type AndroidTvDriverDeps,
  type AppiumSession,
} from './driver.js';
export type {
  AndroidTvAppConfig,
  AndroidTvDriverOptions,
  AppiumOptions,
  VideoOptions,
} from './options.js';
export {
  ANDROID_KEYCODES,
  REMOTE_PROFILE_CAPABILITIES,
  keySupported,
  type RemoteProfile,
} from './keys.js';
export { parsePageSource, type PageSourceOptions, type TestIdAttribute } from './page-source.js';
export type { LogcatScope } from './logcat.js';
export {
  ManagedDeviceProvider,
  CLEAN_SNAPSHOT,
  avdName,
  type ManagedDeviceOptions,
  type ManagedDeviceDeps,
} from './devices/managed.js';
export {
  prepareAndroidDevice,
  type AndroidDeviceInfo,
  type PrepareDeviceOptions,
} from './devices/prepare.js';
export { startAppiumServer, type AppiumServer, type StartAppiumOptions } from './appium.js';
export { Adb, type LaunchTarget } from './adb.js';
export {
  nodeCommandRunner,
  type CommandRunner,
  type CommandResult,
  type RunOptions,
  type SpawnOptions,
  type SpawnedProcess,
} from './command.js';
export { resolveAndroidSdk, type AndroidSdk } from './sdk.js';
export type { AndroidTvErrorCode } from './errors.js';
