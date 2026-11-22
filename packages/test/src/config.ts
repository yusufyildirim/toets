import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defineConfig as playwrightDefineConfig,
  type PlaywrightTestConfig,
  type Project,
  type ReporterDescription,
} from '@playwright/test';
import type {
  AppTargetConfig,
  CommandDevicesOptions,
  DeviceSpec,
  IdleOptions,
  KeyOverrides,
  MockServerLike,
  Platform,
  RemoteOptions,
  Timeouts,
} from '@dpad-tv/core';
import type { SdkHost } from '@dpad-tv/protocol';
import type { ParityReporterOptions } from './reporter.js';

/** How a project gets its device. Web needs none. */
export type DeviceSelection =
  /** dpad boots, snapshots and resets emulators/simulators through the driver package. */
  | 'managed'
  | { readonly mode: 'managed' }
  /** Already running devices: listed here or in `DPAD_DEVICES` (comma separated). */
  | { readonly mode: 'external'; readonly addresses?: readonly string[] }
  /** Shell commands lease and release devices (device farms, lease brokers). */
  | ({ readonly mode: 'command' } & CommandDevicesOptions);

/** Runtime options shared by all projects; a project's `dpad` field overrides them. */
export interface DpadOptions {
  /**
   * In-app SDK. When on, each launch issues a token and waits for the app to connect, adding
   * the SDK capabilities (idle sync, focus graph, media, launch states, logs). Default off.
   */
  readonly sdk?:
    | boolean
    | {
        readonly port?: number;
        /** Custom host factory; default `createSdkHost` from `@dpad-tv/protocol/host`. */
        readonly createHost?: (opts: { port?: number }) => Promise<SdkHost>;
      };
  /** Host-side network mocking with `@dpad-tv/mock` (`network.mock`). Default off. */
  readonly mock?:
    | boolean
    | {
        readonly port?: number;
        /** Custom server factory; default `createMockServer` from `@dpad-tv/mock`. */
        readonly createServer?: (opts: { port?: number }) => Promise<MockServerLike>;
      };
  /**
   * App-level key overrides: how a semantic key is performed when the app maps it to another
   * gesture, e.g. `{ FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } }`. Flagged in reports.
   */
  readonly keyOverrides?: KeyOverrides;
  /** Assertion timeouts come from Playwright's `expect.timeout`. */
  readonly timeouts?: Partial<Omit<Timeouts, 'expectMs'>>;
  readonly idle?: Partial<IdleOptions>;
  readonly remote?: Partial<RemoteOptions>;
  /** Per-step artifacts attached to every action step. Both default off (they cost time on devices). */
  readonly steps?: { readonly screenshot?: boolean; readonly snapshot?: boolean };
  /** Screen recording per test, where the driver has `video`. Default `off`. */
  readonly video?: 'off' | 'on' | 'retain-on-failure';
}

/** Per-platform app config, keyed like the platform helpers. */
export interface AppTargets {
  readonly web?: AppTargetConfig;
  readonly androidTV?: AppTargetConfig;
  readonly tvOS?: AppTargetConfig;
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
  readonly driverOptions: Readonly<Record<string, unknown>>;
  readonly app: AppTargetConfig;
  readonly device: Readonly<Record<string, unknown>>;
  readonly devices: DeviceSelection | undefined;
  readonly options: DpadOptions;
}

export interface PlatformProjectOptions extends Omit<Project, 'use'> {
  /** Driver module override (package name or path relative to the config). */
  readonly driver?: string;
  /** Options passed to the driver's `createDriver`. */
  readonly driverOptions?: Readonly<Record<string, unknown>>;
  /** Merged over the top-level `app` entry for this platform. */
  readonly app?: AppTargetConfig;
  /** Device spec for the provider, e.g. `{ model: 'tv_1080p', osVersion: '34' }`. */
  readonly device?: Omit<DeviceSpec, 'platform'>;
  /** Default: `managed` when the driver provides devices. */
  readonly devices?: DeviceSelection;
  /** Overrides the top-level `dpad` options for this project. */
  readonly dpad?: DpadOptions;
  readonly use?: Project['use'];
}

function platformProject(platform: Platform, opts: PlatformProjectOptions = {}): Project {
  const { driver, driverOptions, app, device, devices, dpad, use, ...project } = opts;
  const config: DpadProjectConfig = {
    platform,
    driver: driver ?? DEFAULT_DRIVER[platform],
    driverOptions: driverOptions ?? {},
    app: app ?? {},
    device: device ?? {},
    devices,
    options: dpad ?? {},
  };
  return { name: platform, ...project, use: { ...use, dpad: config } };
}

/** Playwright projects, one per platform. Project name defaults to the platform name. */
export const platforms = {
  /** Chromium through `@dpad-tv/driver-web`. */
  web: (opts?: PlatformProjectOptions): Project => platformProject('web', opts),
  /** Android TV / Fire TV emulators through `@dpad-tv/driver-android-tv`. */
  androidTV: (opts?: PlatformProjectOptions): Project => platformProject('android-tv', opts),
  /** tvOS simulators through `@dpad-tv/driver-tvos`. */
  tvOS: (opts?: PlatformProjectOptions): Project => platformProject('tvos', opts),
};

export interface DpadConfig extends PlaywrightTestConfig {
  /** App under test per platform: URL, APK and package, app bundle and bundle ID, ... */
  readonly app?: AppTargets;
  /** Runtime options for every project. */
  readonly dpad?: DpadOptions;
  /** Parity matrix reporter, added after the configured reporters. `false` disables it. */
  readonly parityReport?: false | ParityReporterOptions;
}

function mergeOptions(base: DpadOptions, over: DpadOptions): DpadOptions {
  return {
    ...base,
    ...over,
    keyOverrides: { ...base.keyOverrides, ...over.keyOverrides },
    timeouts: { ...base.timeouts, ...over.timeouts },
    idle: { ...base.idle, ...over.idle },
    remote: { ...base.remote, ...over.remote },
    steps: { ...base.steps, ...over.steps },
  };
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
      ? [[process.env.CI ? 'dot' : 'list']]
      : typeof reporter === 'string'
        ? [[reporter]]
        : [...reporter];
  return [...base, [parityReporterPath(), opts]];
}

/**
 * Playwright's `defineConfig` plus dpad: the per-platform `app` entries and shared `dpad`
 * options are merged into every `platforms.*()` project, and the parity matrix reporter is
 * added.
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
    return { ...project, use: { ...project.use, dpad: resolved } };
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
