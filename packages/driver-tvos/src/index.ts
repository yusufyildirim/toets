/**
 * dpad driver for tvOS simulators, built on WebdriverIO + Appium XCUITest. `@dpad-tv/test`
 * loads the default export lazily for `platforms.tvOS()` projects.
 *
 * Docs: `node_modules/@dpad-tv/driver-tvos/docs`.
 *
 * @packageDocumentation
 */
import type { DriverModule } from '@dpad-tv/core';
import { createManagedDeviceProvider } from './devices.js';
import { TvosDriver } from './driver.js';
import type { TvosDriverOptions } from './options.js';

/** The tvOS {@link DriverModule}: drivers per worker and the `managed` device provider. */
const tvosDriverModule: DriverModule<TvosDriverOptions> = {
  platform: 'tvos',
  async createDriver(options, ctx) {
    return new TvosDriver(options, ctx);
  },
  createDeviceProvider(options) {
    return createManagedDeviceProvider({
      ...options.managed,
      ...(options.deviceSet && options.managed?.deviceSet === undefined
        ? { deviceSet: options.deviceSet }
        : {}),
    });
  },
};

export default tvosDriverModule;

export { TvosDriver, buildCapabilities, type TvosDriverDeps } from './driver.js';
export type { TvosAppConfig, TvosDriverOptions } from './options.js';
export { REMOTE_BUTTONS, TVOS_CAPABILITIES, type RemoteButton } from './keys.js';
export {
  DEFAULT_TVOS_MODELS,
  createManagedDeviceProvider,
  deviceSetFromLease,
  prepareSimulator,
  type TvosManagedDeviceOptions,
  type TvosSimulator,
} from './devices.js';
export { ensurePrebuiltWda, defaultWdaCacheDir, type PrebuiltWdaOptions } from './wda.js';
export { startAppiumServer, type AppiumServer, type StartAppiumOptions } from './appium-server.js';
export {
  defaultRunner,
  type CommandRunner,
  type CommandResult,
  type RunOptions,
} from './command.js';
export { parseSource, type WdaSourceNode } from './source.js';
export { TvosErrorCode } from './errors.js';
export type { TvosSession, CreateSession, SessionRequest } from './session.js';
