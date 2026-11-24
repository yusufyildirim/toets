/**
 * `@toets/driver-web`: the toets driver for web TV apps in Chromium, built on Playwright.
 *
 * The default export is the {@link DriverModule} the toets runner loads for `platforms.web()`.
 * Use {@link createWebDriver} to drive a page directly (scripts, tools).
 *
 * @packageDocumentation
 */
import type { DriverModule } from '@toets/core';
import { createWebDriver } from './driver.js';
import type { WebDriverOptions } from './options.js';

export { WebDriver, createWebDriver, type WebDriverContext } from './driver.js';
export { DEFAULT_KEY_MAP, type ResolvedKeyMap, type WebKeyMap, type WebKeySpec } from './keys.js';
export { launchUrl } from './launch.js';
export {
  DEFAULT_VIEWPORT,
  type LaunchTransport,
  type LaunchWaitUntil,
  type ResolvedWebOptions,
  type WebDriverOptions,
} from './options.js';

/** The web platform's driver module (default export), loaded lazily by `@toets/test`. */
const webDriverModule: DriverModule<WebDriverOptions> = {
  platform: 'web',
  async createDriver(options, ctx) {
    return createWebDriver(options, ctx);
  },
};

export default webDriverModule;
