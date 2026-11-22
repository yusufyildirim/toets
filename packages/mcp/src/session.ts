import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DpadError, packageDocsLink, type AppRuntime, type LaunchOptions } from '@dpad-tv/core';
import { mergeRuntimeConfig, RunningTarget, type TargetConfig } from '@dpad-tv/core/runner';
import { mockServerFactory } from '@dpad-tv/mock';
import type { McpConfig, McpTargetConfig } from './config.js';

const DEFAULT_EXPECT_TIMEOUT_MS = 5000;

interface ActiveTarget {
  readonly name: string;
  readonly target: RunningTarget;
  readonly expectTimeoutMs: number;
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
 * One agent session: at most one active target at a time, started lazily on first use and
 * switched by `launch({ target })`. A target comes up exactly like in a test worker
 * (`RunningTarget` from `@dpad-tv/core/runner`: device, driver, mock server, SDK host and the
 * core `AppRuntime`). All device work runs one call at a time so parallel tool calls can not
 * interleave key presses.
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

  get docsDirs(): readonly string[] {
    return (this.opts.config?.docsDirs ?? []).map((d) => resolve(this.opts.baseDir, d));
  }

  /** Runs `fn` after every previously queued call finished. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The runtime of a target, started if needed, without launching the app. */
  async describe(name?: string): Promise<{ name: string; runtime: AppRuntime; launched: boolean }> {
    const active = await this.ensure(name);
    return { name: active.name, runtime: active.target.runtime, launched: active.launched };
  }

  /**
   * (Re)launches the app on a target, isolated like a fresh test: the previous app is
   * terminated; mock handlers, recorded requests, the key log and logs are reset.
   */
  async launch(
    name: string | undefined,
    opts: LaunchOptions,
  ): Promise<{ name: string; runtime: AppRuntime }> {
    const active = await this.ensure(name);
    const runtime = active.target.runtime;
    active.launched = false;
    await runtime.isolate();
    await runtime.app.launch(opts);
    active.launched = true;
    return { name: active.name, runtime };
  }

  /** The launched app's runtime and assert timeout; throws a guiding error before `launch`. */
  launched(): { runtime: AppRuntime; expectTimeoutMs: number } {
    if (!this.active?.launched) {
      throw new DpadError('MCP_NOT_LAUNCHED', 'The app is not running yet.', {
        hint: 'Call `launch` first. It starts the target and the app; every device tool needs it.',
        docs: packageDocsLink('mcp', 'tools'),
      });
    }
    return { runtime: this.active.target.runtime, expectTimeoutMs: this.active.expectTimeoutMs };
  }

  /** Stops the active target and releases its device. Safe to call more than once. */
  async dispose(): Promise<void> {
    const active = this.active;
    this.active = null;
    await active?.target.stop(this.opts.log);
  }

  private defaultTargetName(): string | null {
    return this.opts.config?.defaultTarget ?? this.targetNames[0] ?? null;
  }

  private async ensure(name: string | undefined): Promise<ActiveTarget> {
    const config = this.opts.config;
    if (!config) {
      throw new DpadError('MCP_NO_CONFIG', 'No dpad config, so there is no target to drive.', {
        hint: 'Start the server where your dpad test config (playwright.config.ts with platforms.*() projects) lives, create `dpad.mcp.config.ts` with `targets`, or pass `--config <file>`; then restart the MCP server. `docs_search` works without it.',
        docs: packageDocsLink('mcp', 'setup'),
      });
    }
    const wanted = name ?? this.active?.name ?? this.defaultTargetName();
    const spec = wanted === null ? undefined : config.targets[wanted];
    if (wanted === null || !spec) {
      throw new DpadError('MCP_UNKNOWN_TARGET', `Unknown target "${String(wanted)}".`, {
        hint: `Configured targets: ${this.targetNames.join(', ')}.`,
        docs: packageDocsLink('mcp', 'setup'),
      });
    }
    if (this.active?.name === wanted) return this.active;
    await this.dispose();
    const target = await RunningTarget.start(targetConfig(config, spec), {
      workerIndex: 0,
      parallelIndex: 0,
      configDir: this.opts.baseDir,
      artifactsDir: resolve(this.opts.baseDir, config.artifactsDir ?? join(tmpdir(), 'dpad-mcp')),
      log: this.opts.log,
      createMockServer: mockServerFactory,
    });
    this.opts.log(`dpad mcp: target "${wanted}" (${target.driver.platform}) ready`);
    this.active = {
      name: wanted,
      target,
      expectTimeoutMs: spec.expectTimeoutMs ?? config.expectTimeoutMs ?? DEFAULT_EXPECT_TIMEOUT_MS,
      launched: false,
    };
    return this.active;
  }
}

function targetConfig(config: McpConfig, spec: McpTargetConfig): TargetConfig {
  const { model, osVersion } = spec;
  return {
    driver: spec.driver,
    ...(spec.platform === undefined ? {} : { platform: spec.platform }),
    driverOptions: spec.options ?? {},
    app: spec.app ?? {},
    device: {
      ...(model === undefined ? {} : { model }),
      ...(osVersion === undefined ? {} : { osVersion }),
    },
    ...(spec.devices === undefined ? {} : { devices: spec.devices }),
    options: mergeRuntimeConfig(config.dpad ?? {}, spec.dpad ?? {}),
  };
}
