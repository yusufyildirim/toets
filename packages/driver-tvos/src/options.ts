import { resolve } from 'node:path';
import type { AppTargetConfig } from '@toets/core';
import type { TvosManagedDeviceOptions } from './devices.js';
import { DOCS, TvosErrorCode, tvosError } from './errors.js';

/**
 * The app under test, from the user's toets config (`app.tvOS`). App-specific, so it lives in
 * user config, never in toets.
 */
export interface TvosAppConfig {
  /** `CFBundleIdentifier` of the app, e.g. `com.example.tv`. */
  readonly bundleId: string;
  /** Simulator `.app` build, relative to the config file. Installed on start; omit to test an installed app. */
  readonly app?: string;
  /** Extra launch arguments, passed before toets's `-__toets <payload>`. */
  readonly launchArguments?: readonly string[];
  /** Environment variables for the app process. */
  readonly launchEnvironment?: Readonly<Record<string, string>>;
}

/** Options of the tvOS platform project (`platforms.tvOS({ ... })`). All optional. */
export interface TvosDriverOptions {
  /** Simulator UDID to drive when the runner provides no device lease. */
  readonly udid?: string;
  /**
   * CoreSimulator device set of the simulator (`simctl --set`). Default: the lease's
   * `meta.deviceSet`, else Xcode's default set.
   */
  readonly deviceSet?: string;
  readonly appium?: {
    /** URL of an Appium server you run yourself. Default: toets starts its pinned Appium. */
    readonly url?: string;
    /** `APPIUM_HOME` for the started server. Default: this package (pinned XCUITest driver). */
    readonly home?: string;
    /** Port for the started server. Default: a free port. */
    readonly port?: number;
    /** Extra Appium server CLI arguments. */
    readonly args?: readonly string[];
    /** Default 60000. */
    readonly startTimeoutMs?: number;
  };
  readonly wda?: {
    /**
     * `prebuilt` (default): toets builds WebDriverAgent once per WDA/Xcode version and installs
     * it, works with custom device sets. `xcodebuild`: XCUITest's per-session build and launch,
     * default device set only.
     */
    readonly mode?: 'prebuilt' | 'xcodebuild';
    /** A ready WebDriverAgent runner `.app` to install instead of building one. */
    readonly path?: string;
    /** Default `~/Library/Caches/toets/tvos-wda`. */
    readonly cacheDir?: string;
    /** Default 900000. */
    readonly buildTimeoutMs?: number;
  };
  /** Maximum time to open the Appium session (installs and launches WDA). Default 300000. */
  readonly sessionTimeoutMs?: number;
  /** Extra Appium capabilities, merged last (escape hatch for XCUITest tuning). */
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly logs?: {
    /** Collect the app's unified log. Default `true`. */
    readonly enabled?: boolean;
    /** Process to collect logs from. Default: the app's `CFBundleExecutable`. */
    readonly process?: string;
  };
  /** Options of the `managed` device provider. */
  readonly managed?: TvosManagedDeviceOptions;
}

export function resolveAppConfig(
  app: AppTargetConfig,
  configDir: string = process.cwd(),
): TvosAppConfig {
  const { bundleId, app: appPath, launchArguments, launchEnvironment } = app;
  const fail = (what: string) =>
    tvosError(TvosErrorCode.CONFIG, `Invalid tvOS app config: ${what}.`, {
      hint: "Set `app: { tvOS: { bundleId: 'com.example.tv', app: './build/App.app' } }` in your toets config.",
      docs: DOCS.setup,
    });
  if (typeof bundleId !== 'string' || bundleId === '') throw fail('`bundleId` is required');
  if (appPath !== undefined && typeof appPath !== 'string') throw fail('`app` must be a path');
  if (
    launchArguments !== undefined &&
    !(Array.isArray(launchArguments) && launchArguments.every((a) => typeof a === 'string'))
  ) {
    throw fail('`launchArguments` must be an array of strings');
  }
  if (
    launchEnvironment !== undefined &&
    (typeof launchEnvironment !== 'object' ||
      launchEnvironment === null ||
      !Object.values(launchEnvironment).every((v) => typeof v === 'string'))
  ) {
    throw fail('`launchEnvironment` must map names to strings');
  }
  return {
    bundleId,
    ...(appPath === undefined ? {} : { app: resolve(configDir, appPath) }),
    ...(launchArguments === undefined ? {} : { launchArguments: launchArguments as string[] }),
    ...(launchEnvironment === undefined
      ? {}
      : { launchEnvironment: launchEnvironment as Record<string, string> }),
  };
}
