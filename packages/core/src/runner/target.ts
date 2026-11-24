import { mkdir } from 'node:fs/promises';
import type { SdkHost } from '@toets/protocol';
import { createSdkHost } from '@toets/protocol/host';
import type { DeviceLease } from '../devices.js';
import type { AppTargetConfig, Driver, DriverModule } from '../driver.js';
import { ToetsError, packageDocsLink } from '../errors.js';
import type { MockServerConfig, MockServerLike } from '../mock.js';
import type { Platform } from '../platform.js';
import { AppRuntime } from '../runtime/app.js';
import type { IdleOptions, KeyOverrides, RemoteOptions, Timeouts } from '../runtime/options.js';
import { selectDeviceProvider, type DeviceSelection } from './devices.js';
import { loadDriverModule } from './load.js';

/**
 * Creates the host-side mock server from the `mock` settings; `createMockServer` from
 * `@toets/mock` fits (runners pass it the MSW handlers the user configured).
 */
export type MockServerFactory = (opts: MockServerConfig) => Promise<MockServerLike>;

/**
 * Runtime options every runner understands: the `toets` options of the test config, which the
 * MCP server reads too.
 */
export interface RuntimeConfig {
  /**
   * In-app SDK. When on, each launch issues a token and waits for the app to connect, adding
   * the SDK capabilities (idle sync, focus graph, media, launch states, logs). Default off.
   */
  readonly sdk?:
    | boolean
    | {
        readonly port?: number;
        /** Custom host factory; default `createSdkHost` from `@toets/protocol/host`. */
        readonly createHost?: (opts: { port?: number }) => Promise<SdkHost>;
      };
  /**
   * Host-side network mocking with `@toets/mock` (`network.mock`): `true`, or the server
   * settings (baseline handlers, unhandled request policy, ...). Default off.
   */
  readonly mock?:
    | boolean
    | (MockServerConfig & {
        /** Custom server factory; default `createMockServer` from `@toets/mock`. */
        readonly createServer?: MockServerFactory;
      });
  /**
   * App-level key overrides: how a semantic key is performed when the app maps it to another
   * gesture, e.g. `{ FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } }`. Flagged in reports.
   */
  readonly keyOverrides?: KeyOverrides;
  readonly timeouts?: Partial<Timeouts>;
  readonly idle?: Partial<IdleOptions>;
  readonly remote?: Partial<RemoteOptions>;
}

/**
 * Merges an on/off-or-settings option: `false` turns it off, `true` keeps the base settings,
 * settings merge key by key over the base ones.
 */
function mergeToggle<S extends object>(
  base: boolean | S | undefined,
  over: boolean | S | undefined,
): boolean | S | undefined {
  if (over === undefined || over === false) return over ?? base;
  const settings = typeof base === 'object' ? base : undefined;
  if (over === true) return settings ?? true;
  return { ...settings, ...over };
}

/**
 * Merges runtime options: `over` wins, nested option groups merge key by key. `sdk` and `mock`
 * settings merge too, so a project's `mock: { port }` keeps the shared baseline handlers.
 */
export function mergeRuntimeConfig<T extends RuntimeConfig>(base: T, over: T): T {
  const sdk = mergeToggle(base.sdk, over.sdk);
  const mock = mergeToggle(base.mock, over.mock);
  return {
    ...base,
    ...over,
    ...(sdk === undefined ? {} : { sdk }),
    ...(mock === undefined ? {} : { mock }),
    keyOverrides: { ...base.keyOverrides, ...over.keyOverrides },
    timeouts: { ...base.timeouts, ...over.timeouts },
    idle: { ...base.idle, ...over.idle },
    remote: { ...base.remote, ...over.remote },
  };
}

/** One app target to run: driver, app, device and runtime options. */
export interface TargetConfig {
  /** Expected platform; the driver module must drive it. Default: whatever the driver drives. */
  readonly platform?: Platform;
  /** Driver package name, path relative to `configDir`, or the `DriverModule` itself. */
  readonly driver: string | DriverModule<never>;
  /** The driver's own options, passed to `createDriver` and `createDeviceProvider`. */
  readonly driverOptions?: Readonly<Record<string, unknown>>;
  readonly app?: AppTargetConfig;
  /** What the device provider is asked for. */
  readonly device?: { readonly model?: string; readonly osVersion?: string };
  /** Default: `managed` when the driver provides devices. */
  readonly devices?: DeviceSelection;
  readonly options?: RuntimeConfig;
}

export interface TargetContext {
  /** Playwright's worker index (`0` outside the test runner). */
  readonly workerIndex: number;
  /** Worker slot: picks the external device and command lease. `0` outside the test runner. */
  readonly parallelIndex: number;
  /** Directory driver paths and relative app paths resolve against. */
  readonly configDir: string;
  readonly artifactsDir: string;
  readonly log: (message: string) => void;
  /**
   * Mock server factory used when `options.mock` is on without its own `createServer`. The core
   * does not depend on `@toets/mock`; runners pass its `createMockServer`.
   */
  readonly createMockServer?: MockServerFactory;
}

async function startSdkHost(
  sdk: RuntimeConfig['sdk'],
  log: (m: string) => void,
): Promise<SdkHost | undefined> {
  if (!sdk) return undefined;
  const port = typeof sdk === 'object' ? sdk.port : undefined;
  const opts = port === undefined ? {} : { port };
  if (typeof sdk === 'object' && sdk.createHost) return sdk.createHost(opts);
  return createSdkHost({
    ...opts,
    onEvent: (e) => {
      if (e.type === 'rejected') log(`SDK host rejected a connection (${e.reason}): ${e.message}`);
      else if (e.type === 'session') log(`SDK connected: ${e.hello.sdk} (${e.hello.framework})`);
      else if (e.type === 'session-closed') log(`SDK session closed: ${e.code} ${e.reason}`);
    },
  });
}

async function startMockServer(
  mock: RuntimeConfig['mock'],
  fallback: MockServerFactory | undefined,
): Promise<MockServerLike | undefined> {
  if (!mock) return undefined;
  const { createServer, ...settings } = typeof mock === 'object' ? mock : {};
  const opts: MockServerConfig = Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined),
  );
  const create = createServer ?? fallback;
  if (!create) {
    throw new ToetsError('MOCK_UNAVAILABLE', 'Network mocking is on, but no mock server is set.', {
      hint: 'Pass `createMockServer` from @toets/mock to startTarget, or set `mock.createServer`.',
      docs: packageDocsLink('core', 'network'),
    });
  }
  return create(opts);
}

/**
 * A running target: device lease, started driver, mock server, SDK host and the app runtime.
 * What one Playwright worker or one MCP session owns.
 */
export class RunningTarget {
  private constructor(
    readonly runtime: AppRuntime,
    readonly module: DriverModule,
    readonly lease: DeviceLease | undefined,
    private readonly disposers: (() => Promise<void>)[],
  ) {}

  get driver(): Driver {
    return this.runtime.driver;
  }

  /**
   * Starts everything a target needs, in order: device lease, driver session, mock server, SDK
   * host, runtime. When a step fails, what already started is stopped before the error is
   * rethrown.
   */
  static async start(config: TargetConfig, ctx: TargetContext): Promise<RunningTarget> {
    const disposers: (() => Promise<void>)[] = [];
    const options = config.options ?? {};
    const driverOptions = config.driverOptions ?? {};
    try {
      await mkdir(ctx.artifactsDir, { recursive: true });
      const module = await loadDriverModule(config.driver, ctx.configDir, config.platform);

      const provider = selectDeviceProvider(config.devices, module, driverOptions);
      let lease: DeviceLease | undefined;
      if (provider) {
        disposers.push(() => provider.dispose());
        lease = await provider.acquire(
          { ...config.device, platform: module.platform },
          { workerIndex: ctx.workerIndex, parallelIndex: ctx.parallelIndex },
        );
        const held = lease;
        disposers.push(() => held.release());
        ctx.log(`leased ${module.platform} device ${lease.address}`);
      }

      const driver = await module.createDriver(driverOptions, {
        app: config.app ?? {},
        configDir: ctx.configDir,
        ...(lease ? { device: lease } : {}),
        workerIndex: ctx.workerIndex,
        artifactsDir: ctx.artifactsDir,
        log: ctx.log,
      });
      disposers.push(() => driver.stop());
      await driver.start();

      const mock = await startMockServer(options.mock, ctx.createMockServer);
      if (mock) disposers.push(() => mock.close());
      const sdkHost = await startSdkHost(options.sdk, ctx.log);
      if (sdkHost) disposers.push(() => sdkHost.close());

      const runtime = new AppRuntime({
        driver,
        sdkHost,
        mock,
        keyOverrides: options.keyOverrides,
        timeouts: options.timeouts,
        idle: options.idle,
        remote: options.remote,
        log: ctx.log,
      });
      disposers.push(() => runtime.dispose());
      return new RunningTarget(runtime, module, lease, disposers);
    } catch (error) {
      await RunningTarget.dispose(disposers, ctx.log);
      throw error;
    }
  }

  private static async dispose(
    disposers: readonly (() => Promise<void>)[],
    log: (message: string) => void,
  ): Promise<void> {
    for (const dispose of [...disposers].reverse()) {
      try {
        await dispose();
      } catch (e) {
        log(`teardown step failed: ${String(e)}`);
      }
    }
  }

  /** Stops everything in reverse start order. Teardown errors are logged, never thrown. */
  async stop(log: (message: string) => void): Promise<void> {
    const disposers = this.disposers.splice(0);
    await RunningTarget.dispose(disposers, log);
  }
}
