import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defineConfig as playwrightDefineConfig,
  type PlaywrightTestConfig,
  type Project,
  type ReporterDescription,
} from '@playwright/test';
import type { AppTargetConfig, Platform, Timeouts } from '@dpad-tv/core';
import { mergeRuntimeConfig, type DeviceSelection, type RuntimeConfig } from '@dpad-tv/core/runner';
import type { AndroidTvAppConfig, AndroidTvDriverOptions } from '@dpad-tv/driver-android-tv';
import type { TvosAppConfig, TvosDriverOptions } from '@dpad-tv/driver-tvos';
import type { WebDriverOptions } from '@dpad-tv/driver-web';
import type { ParityReporterOptions } from './reporter.js';

export type { DeviceSelection };

/**
 * Runtime options shared by all projects; a project's `dpad` field overrides them. `sdk`,
 * `mock`, `keyOverrides`, `idle` and `remote` are the core's runtime options (the MCP server
 * reads the same ones); `steps` and `video` are test-only.
 */
export interface DpadOptions extends Omit<RuntimeConfig, 'timeouts'> {
  /** Assertion timeouts come from Playwright's `expect.timeout`. */
  readonly timeouts?: Partial<Omit<Timeouts, 'expectMs'>>;
  /** Per-step artifacts attached to every action step. Both default off (they cost time on devices). */
  readonly steps?: { readonly screenshot?: boolean; readonly snapshot?: boolean };
  /** Screen recording per test, where the driver has `video`. Default `off`. */
  readonly video?: 'off' | 'on' | 'retain-on-failure';
}

/** Per-platform app config, keyed like the platform helpers. Each driver documents its keys. */
export interface AppTargets {
  /** `url`, plus any web driver option (the project's options win). */
  readonly web?: WebDriverOptions;
  /** `package`, optional `apk` (relative to this config) and `activity`. */
  readonly androidTV?: AndroidTvAppConfig;
  /** `bundleId`, optional `app` (relative to this config), `launchArguments`, `launchEnvironment`. */
  readonly tvOS?: TvosAppConfig;
}

export type PlatformKey = keyof AppTargets;

export const PLATFORM_OF: Readonly<Record<PlatformKey, Platform>> = {
  web: 'web',
  androidTV: 'android-tv',
  tvOS: 'tvos',
};

const KEY_OF: Readonly<Record<Platform, PlatformKey>> = {
  web: 'web',
  'android-tv': 'androidTV',
  tvos: 'tvOS',
};

const DEFAULT_DRIVER: Readonly<Record<Platform, string>> = {
  web: '@dpad-tv/driver-web',
  'android-tv': '@dpad-tv/driver-android-tv',
  tvos: '@dpad-tv/driver-tvos',
};

/** What a dpad project carries in `use.dpad`. Built by `platforms.*()` and `defineConfig`. */
export interface DpadProjectConfig {
  readonly platform: Platform;
  /** Driver module: a package name or a path relative to the config file. */
  readonly driver: string;
  /** The driver's own options: every key of the `platforms.*()` call dpad and Playwright do not own. */
  readonly driverOptions: Readonly<Record<string, unknown>>;
  readonly app: AppTargetConfig;
  /** What the device provider is asked for (`model`, `osVersion`). */
  readonly device: { readonly model?: string; readonly osVersion?: string };
  readonly devices: DeviceSelection | undefined;
  readonly options: DpadOptions;
}

/** Keys of a Playwright `Project` passed through unchanged (`use` is merged separately). */
const PROJECT_KEYS = [
  'default',
  'dependencies',
  'expect',
  'fullyParallel',
  'grep',
  'grepInvert',
  'ignoreSnapshots',
  'metadata',
  'name',
  'outputDir',
  'repeatEach',
  'respectGitIgnore',
  'retries',
  'snapshotDir',
  'snapshotPathTemplate',
  'teardown',
  'testDir',
  'testIgnore',
  'testMatch',
  'timeout',
  'workers',
] as const satisfies readonly (keyof Project)[];

/** Fails to compile when Playwright adds a `Project` key missing from `PROJECT_KEYS`. */
type UnlistedProjectKey = Exclude<keyof Project, (typeof PROJECT_KEYS)[number] | 'use'>;
const _allProjectKeysListed: [UnlistedProjectKey] extends [never] ? true : UnlistedProjectKey =
  true;
void _allProjectKeysListed;

/** dpad's own keys of a platform project; everything else that is not Playwright's is the driver's. */
export interface DpadProjectKeys<App> {
  /** Driver module override (package name or path relative to the config). */
  readonly driver?: string;
  /** Merged over the top-level `app` entry for this platform. */
  readonly app?: Partial<App>;
  /** Device model for the device provider, e.g. `tv_1080p` or `Apple TV 4K (3rd generation)`. */
  readonly model?: string;
  /** OS version for the device provider, e.g. `34` (Android API level) or `18.0`. */
  readonly osVersion?: string;
  /** Default: `managed` when the driver provides devices. */
  readonly devices?: DeviceSelection;
  /** Overrides the top-level `dpad` options for this project. */
  readonly dpad?: DpadOptions;
  readonly use?: Project['use'];
}

/**
 * Options of a `platforms.*()` project: Playwright project fields, dpad's own keys and the
 * driver's options (`Driver`), all flat.
 */
export type PlatformProjectOptions<
  Driver extends object = Readonly<Record<string, unknown>>,
  App extends object = AppTargetConfig,
> = Omit<Project, 'use'> & DpadProjectKeys<App> & Omit<Driver, keyof DpadProjectKeys<App>>;

/** Fails to compile when a driver option shadows a Playwright or dpad key. */
type Shadowed<Driver> = keyof Driver & (keyof Project | keyof DpadProjectKeys<object>);
const _noShadowedDriverOptions: [
  Shadowed<WebDriverOptions> | Shadowed<AndroidTvDriverOptions> | Shadowed<TvosDriverOptions>,
] extends [never]
  ? true
  : never = true;
void _noShadowedDriverOptions;

const OWN_KEYS = new Set<string>([
  ...PROJECT_KEYS,
  'driver',
  'app',
  'model',
  'osVersion',
  'devices',
  'dpad',
  'use',
]);

function platformProject(platform: Platform, opts: PlatformProjectOptions = {}): Project {
  const { driver, app, model, osVersion, devices, dpad, use } = opts;
  const project: Record<string, unknown> = {};
  const driverOptions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if ((PROJECT_KEYS as readonly string[]).includes(key)) project[key] = value;
    else if (!OWN_KEYS.has(key)) driverOptions[key] = value;
  }
  const config: DpadProjectConfig = {
    platform,
    driver: driver ?? DEFAULT_DRIVER[platform],
    driverOptions,
    app: app ?? {},
    device: {
      ...(model === undefined ? {} : { model }),
      ...(osVersion === undefined ? {} : { osVersion }),
    },
    devices,
    options: dpad ?? {},
  };
  return { name: platform, ...project, use: { ...use, dpad: config } };
}

/**
 * Playwright projects, one per platform. The project name defaults to the platform name. A custom
 * `driver` with other options passes its options type: `platforms.web<MyOptions>({ ... })`.
 */
export const platforms = {
  /** Chromium through `@dpad-tv/driver-web`. */
  web: <Driver extends object = WebDriverOptions>(
    opts?: PlatformProjectOptions<Driver, WebDriverOptions>,
  ): Project => platformProject('web', opts),
  /** Android TV / Fire TV emulators through `@dpad-tv/driver-android-tv`. */
  androidTV: <Driver extends object = AndroidTvDriverOptions>(
    opts?: PlatformProjectOptions<Driver, AndroidTvAppConfig>,
  ): Project => platformProject('android-tv', opts),
  /** tvOS simulators through `@dpad-tv/driver-tvos`. */
  tvOS: <Driver extends object = TvosDriverOptions>(
    opts?: PlatformProjectOptions<Driver, TvosAppConfig>,
  ): Project => platformProject('tvos', opts),
};

export interface DpadConfig extends PlaywrightTestConfig {
  /** App under test per platform: URL, APK and package, app bundle and bundle ID, ... */
  readonly app?: AppTargets;
  /** Runtime options for every project. */
  readonly dpad?: DpadOptions;
  /** Parity matrix reporter, added after the configured reporters. `false` disables it. */
  readonly parityReport?: false | ParityReporterOptions;
}

/**
 * Default `snapshotPathTemplate` of dpad projects: Playwright's default without the host OS
 * suffix (`{-snapshotSuffix}`). Baselines are per project (so per platform and device) and the
 * same on every machine; device screenshots do not depend on the host.
 */
const SNAPSHOT_PATH_TEMPLATE =
  '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}';

function mergeOptions(base: DpadOptions, over: DpadOptions): DpadOptions {
  return { ...mergeRuntimeConfig(base, over), steps: { ...base.steps, ...over.steps } };
}

/** Absolute path of the reporter module next to this file (`.ts` in source, `.js` built). */
function parityReporterPath(): string {
  const here = fileURLToPath(import.meta.url);
  return fileURLToPath(new URL(`./reporter${extname(here)}`, import.meta.url));
}

function withParityReporter(
  reporter: PlaywrightTestConfig['reporter'],
  opts: ParityReporterOptions,
): ReporterDescription[] {
  const base: ReporterDescription[] =
    reporter === undefined
      ? [[process.env.CI ? 'dot' : 'list'], ['html', { open: 'never' }]]
      : typeof reporter === 'string'
        ? [[reporter]]
        : [...reporter];
  return [...base, [parityReporterPath(), opts]];
}

/**
 * Playwright's `defineConfig` plus dpad: the per-platform `app` entries and shared `dpad`
 * options are merged into every `platforms.*()` project, and the parity matrix reporter is
 * added. dpad projects default `snapshotPathTemplate` to Playwright's default without the host
 * OS suffix, so baselines match across machines; a top-level or project value wins.
 */
export function defineConfig(config: DpadConfig): PlaywrightTestConfig {
  const { app, dpad, parityReport, projects, reporter, ...playwright } = config;
  const merged = projects?.map((project) => {
    const target = (project.use as { dpad?: DpadProjectConfig } | undefined)?.dpad;
    if (!target) return project;
    const resolved: DpadProjectConfig = {
      ...target,
      app: { ...app?.[KEY_OF[target.platform]], ...target.app },
      options: mergeOptions(dpad ?? {}, target.options),
    };
    return {
      ...project,
      snapshotPathTemplate:
        project.snapshotPathTemplate ?? config.snapshotPathTemplate ?? SNAPSHOT_PATH_TEMPLATE,
      use: { ...project.use, dpad: resolved },
    };
  });
  return playwrightDefineConfig({
    ...playwright,
    ...(merged ? { projects: merged } : {}),
    ...(parityReport === false
      ? reporter === undefined
        ? {}
        : { reporter }
      : { reporter: withParityReporter(reporter, parityReport ?? {}) }),
  });
}
