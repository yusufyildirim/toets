import { resolve } from 'node:path';
import type { AppTargetConfig, DeepLinkMapper } from '@toets/core';
import type { AndroidDeepLink } from './deep-link.js';
import type { ManagedDeviceOptions } from './devices/managed.js';
import { DOCS, androidError } from './errors.js';
import type { RemoteProfile } from './keys.js';
import type { LogcatScope } from './logcat.js';
import type { TestIdAttribute } from './page-source.js';

/**
 * The app under test, from the user's toets config (`app.androidTV`). App specifics live here,
 * never in the driver.
 */
export interface AndroidTvAppConfig {
  /** Application id, e.g. `com.example.tv`. */
  readonly package: string;
  /**
   * Activity to launch (`.MainActivity` or a full class name). Default: the activity the TV
   * launcher would start (`LEANBACK_LAUNCHER`, then `LAUNCHER`).
   */
  readonly activity?: string;
  /** APK installed (`adb install -r`) when the driver starts; relative to the config file. Omit when already installed. */
  readonly apk?: string;
  /**
   * Translates the canonical deep link of `launch({ deepLink })` and `openDeepLink` into the
   * intent this app handles: a URI string (a VIEW intent), or an {@link AndroidDeepLink} with
   * action, categories, MIME type and typed extras (Fire TV content intents). Default: the link
   * unchanged, as a VIEW intent. Set it in a project's `app` for one remote profile only.
   *
   * @example
   * deepLink: (link) => ({ action: 'com.example.PLAY', extras: { contentId: link.pathname.slice(1) } })
   */
  readonly deepLink?: DeepLinkMapper<string | AndroidDeepLink>;
}

/** Options of the Android TV driver (`platforms.androidTV({ ... })`). All optional. */
export interface AndroidTvDriverOptions {
  /** Android SDK root. Default: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the OS default. */
  readonly sdkRoot?: string;
  /**
   * Device serial when no device lease is provided (e.g. `emulator-5554`). Default:
   * `ANDROID_SERIAL`.
   */
  readonly serial?: string;
  /** How long `start()` waits for the device to finish booting. Default 180 000 ms. */
  readonly bootTimeoutMs?: number;
  readonly appium?: AppiumOptions;
  /** Page-source attribute holding test IDs. Default `resource-id` (package prefix stripped). */
  readonly testIdAttribute?: TestIdAttribute;
  /** Remote whose keys the capabilities describe. Default `android-tv`. */
  readonly remote?: RemoteProfile;
  /** Which logcat lines `drainLogs()` returns, or `false` to not collect. Default `app`. */
  readonly logcat?: LogcatScope | false;
  readonly video?: VideoOptions;
  /** Settings for the `managed` device provider. */
  readonly managed?: ManagedDeviceOptions;
}

export interface AppiumOptions {
  /**
   * URL of an Appium server you run yourself (needs the UiAutomator2 driver). Default: the
   * driver starts its own pinned Appium server on a free port, one per worker.
   */
  readonly url?: string;
  /** Port for the driver-started server. Default: a free port. */
  readonly port?: number;
  /** Extra session capabilities, merged last (e.g. `{ 'appium:adbExecTimeout': 60000 }`). */
  readonly capabilities?: Readonly<Record<string, unknown>>;
  /** UiAutomator2 settings applied after the session starts, merged over toets's defaults. */
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface VideoOptions {
  /** Bit rate in bits per second. Default 4 000 000. */
  readonly bitRate?: number;
  /** `ffmpeg` binary used to join recordings longer than 180 s. Default: none. */
  readonly ffmpeg?: string;
}

/** Validates the app config the user put in their toets config. */
export function parseAppConfig(
  app: AppTargetConfig,
  configDir: string = process.cwd(),
): AndroidTvAppConfig {
  const { package: pkg, activity, apk, deepLink } = app;
  if (typeof pkg !== 'string' || !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg)) {
    throw androidError(
      'ANDROID_APP_CONFIG',
      `app.package must be an Android application id, got ${JSON.stringify(pkg)}.`,
      { hint: "Set `app: { androidTV: { package: 'com.example.tv' } }`.", docs: DOCS.setup },
    );
  }
  for (const [name, value] of [
    ['activity', activity],
    ['apk', apk],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value === '')) {
      throw androidError('ANDROID_APP_CONFIG', `app.${name} must be a non-empty string.`, {
        docs: DOCS.setup,
      });
    }
  }
  if (deepLink !== undefined && typeof deepLink !== 'function') {
    throw androidError(
      'ANDROID_APP_CONFIG',
      'app.deepLink must be a function (link: URL) => ....',
      {
        hint: "Set `deepLink: (link) => 'https://example.com' + link.pathname`, or an intent object as its result.",
        docs: DOCS.setup,
      },
    );
  }
  return {
    package: pkg,
    ...(deepLink === undefined
      ? {}
      : { deepLink: deepLink as DeepLinkMapper<string | AndroidDeepLink> }),
    ...(typeof activity === 'string' ? { activity } : {}),
    ...(typeof apk === 'string' ? { apk: resolve(configDir, apk) } : {}),
  };
}
