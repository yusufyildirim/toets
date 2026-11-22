import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DpadError,
  docsLink,
  type DeviceLease,
  type DeviceProvider,
  type Driver,
  type Platform,
} from '@dpad-tv/core';
import type { McpConfig, McpTargetConfig } from './config.js';
import { loadDriverModule } from './driver-loader.js';
import { DriverRuntime, type ScreenRuntime } from './runtime/runtime.js';

interface ActiveTarget {
  readonly name: string;
  readonly driver: Driver;
  readonly runtime: ScreenRuntime;
  readonly lease: DeviceLease | undefined;
  readonly provider: DeviceProvider | undefined;
  started: boolean;
  launched: boolean;
}

export interface SessionOptions {
  /** `null`: no config found; only docs tools work. */
  readonly config: McpConfig | null;
  /** Folder relative paths in the config resolve against. */
  readonly baseDir: string;
  /** Diagnostics sink. Never stdout: on stdio that is the protocol channel. */
  readonly log: (message: string) => void;
}

/**
 * One agent session: at most one active target (driver + device) at a time, created lazily on
 * first use and switched by `launch({ target })`. All device work runs one call at a time so
 * parallel tool calls can not interleave key presses.
 */
export class Session {
  private active: ActiveTarget | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: SessionOptions) {}

  /** Configured target names, in config order. */
  get targetNames(): readonly string[] {
    return Object.keys(this.opts.config?.targets ?? {});
  }

  /** Name of the active target, or the one `launch` would use next. */
  get currentTargetName(): string | null {
    return this.active?.name ?? this.defaultTargetName();
  }

  get expectTimeoutMs(): number {
    return this.opts.config?.expectTimeoutMs ?? 5000;
  }

  get docsDirs(): readonly string[] {
    return (this.opts.config?.docsDirs ?? []).map((d) => resolve(this.opts.baseDir, d));
  }

  get baseDir(): string {
    return this.opts.baseDir;
  }

  /** Runs `fn` after every previously queued call finished. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Driver facts of a target without starting it (`capabilities`). */
  async describe(
    name?: string,
  ): Promise<{ name: string; platform: Platform; runtime: ScreenRuntime; launched: boolean }> {
    const target = await this.ensure(name, false);
    return {
      name: target.name,
      platform: target.driver.platform,
      runtime: target.runtime,
      launched: target.launched,
    };
  }

  /** Starts the target if needed and (re)launches the app on it. */
  async launch(
    name: string | undefined,
    run: (runtime: ScreenRuntime) => Promise<void>,
  ): Promise<{ name: string; runtime: ScreenRuntime }> {
    const target = await this.ensure(name, true);
    target.launched = false;
    await run(target.runtime);
    target.launched = true;
    return { name: target.name, runtime: target.runtime };
  }

  /** The runtime of the launched app; throws a guiding error when nothing is launched. */
  launchedRuntime(): ScreenRuntime {
    if (!this.active?.launched) {
      throw new DpadError('MCP_NOT_LAUNCHED', 'The app is not running yet.', {
        hint: 'Call `launch` first. It starts the target and the app; every device tool needs it.',
        docs: docsLink('mcp/tools'),
      });
    }
    return this.active.runtime;
  }

  /** Stops the active driver and releases its device. Safe to call more than once. */
  async dispose(): Promise<void> {
    const target = this.active;
    this.active = null;
    if (target) await this.teardown(target);
  }

  private defaultTargetName(): string | null {
    return this.opts.config?.defaultTarget ?? this.targetNames[0] ?? null;
  }

  private async ensure(name: string | undefined, start: boolean): Promise<ActiveTarget> {
    const config = this.opts.config;
    if (!config) {
      throw new DpadError('MCP_NO_CONFIG', 'No dpad MCP config, so there is no target to drive.', {
        hint: 'Create `dpad.mcp.config.ts` (or pass `--config <file>`) with `targets`, e.g. `{ targets: { web: { driver: "@dpad-tv/driver-web", app: { url: "http://localhost:3000" } } } }`, then restart the MCP server. `docs_search` works without it.',
        docs: docsLink('mcp/setup'),
      });
    }
    const wanted = name ?? this.active?.name ?? this.defaultTargetName();
    const spec = wanted === null ? undefined : config.targets[wanted];
    if (wanted === null || !spec) {
      throw new DpadError('MCP_UNKNOWN_TARGET', `Unknown target "${String(wanted)}".`, {
        hint: `Configured targets: ${this.targetNames.join(', ')}.`,
        docs: docsLink('mcp/setup'),
      });
    }
    if (this.active && this.active.name !== wanted) {
      const previous = this.active;
      this.active = null;
      await this.teardown(previous);
    }
    this.active ??= await this.create(wanted, spec);
    if (start && !this.active.started) {
      await this.active.driver.start();
      this.active.started = true;
    }
    return this.active;
  }

  private async create(name: string, spec: McpTargetConfig): Promise<ActiveTarget> {
    const module = await loadDriverModule(spec.driver, this.opts.baseDir);
    const options = spec.options ?? {};
    let provider: DeviceProvider | undefined;
    let lease: DeviceLease | undefined;

    if (spec.device && 'address' in spec.device) {
      lease = {
        id: spec.device.address,
        platform: module.platform,
        address: spec.device.address,
        meta: {},
        release: async () => {},
      };
    } else if (spec.device) {
      if (!module.createDeviceProvider) {
        throw new DpadError(
          'MCP_DEVICE_UNSUPPORTED',
          `Driver for ${module.platform} has no managed devices.`,
          { hint: 'Remove `device`, or give an `address`.', docs: docsLink('mcp/setup') },
        );
      }
      provider = module.createDeviceProvider(options);
      const { model, osVersion } = spec.device;
      lease = await provider.acquire(
        {
          platform: module.platform,
          ...(model !== undefined && { model }),
          ...(osVersion !== undefined && { osVersion }),
        },
        { workerIndex: 0, parallelIndex: 0 },
      );
    }

    const artifactsDir = resolve(
      this.opts.baseDir,
      this.opts.config?.artifactsDir ?? join(tmpdir(), 'dpad-mcp'),
    );
    let driver: Driver;
    try {
      await mkdir(artifactsDir, { recursive: true });
      driver = await module.createDriver(options, {
        app: spec.app ?? {},
        configDir: this.opts.baseDir,
        ...(lease && { device: lease }),
        workerIndex: 0,
        artifactsDir,
        log: this.opts.log,
      });
    } catch (error) {
      await lease?.release().catch(() => undefined);
      await provider?.dispose().catch(() => undefined);
      throw error;
    }
    this.opts.log(`dpad mcp: target "${name}" (${module.platform}) ready`);
    return {
      name,
      driver,
      runtime: new DriverRuntime(driver),
      lease,
      provider,
      started: false,
      launched: false,
    };
  }

  private async teardown(target: ActiveTarget): Promise<void> {
    const steps: (() => Promise<void>)[] = [
      () => target.driver.stop(),
      async () => target.lease?.release(),
      async () => target.provider?.dispose(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        this.opts.log(`dpad mcp: cleanup of "${target.name}" failed: ${String(error)}`);
      }
    }
  }
}
