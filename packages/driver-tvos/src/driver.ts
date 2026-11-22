import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Capability,
  Driver,
  DriverCreateContext,
  DriverLaunchOptions,
  ElementRef,
  ElementSnapshot,
  Key,
  LogEntry,
  PressOptions,
  SelectorChain,
  UITree,
} from '@dpad-tv/core';
import { LAUNCH_PARAM, encodeLaunchPayload } from '@dpad-tv/protocol';
import {
  startAppiumServer,
  freePort,
  type AppiumServer,
  type StartAppiumOptions,
} from './appium-server.js';
import { defaultRunner, tail, type CommandRunner } from './command.js';
import { deviceSetFromLease, prepareSimulator, type TvosSimulator } from './devices.js';
import { TvosErrorCode, errorMessage, tvosError } from './errors.js';
import { cropPng } from './image.js';
import { REMOTE_BUTTONS, TVOS_CAPABILITIES } from './keys.js';
import { AppLogStream } from './logs.js';
import { resolveAppConfig, type TvosAppConfig, type TvosDriverOptions } from './options.js';
import { findByRef, focusedIn, queryTree } from './query.js';
import { ScreenRecorder } from './recording.js';
import { createWebdriverioSession, type CreateSession, type TvosSession } from './session.js';
import { Simctl } from './simctl.js';
import { SOURCE_EXCLUDED_ATTRIBUTES, parseSource, type WdaSourceNode } from './source.js';
import { ensurePrebuiltWda, type PrebuiltWdaOptions } from './wda.js';

/** Collaborators of {@link TvosDriver}; replaced by fakes in unit tests. */
export interface TvosDriverDeps {
  readonly runner: CommandRunner;
  readonly createSession: CreateSession;
  readonly startAppium: (opts: StartAppiumOptions) => Promise<AppiumServer>;
  readonly ensureWda: (opts: PrebuiltWdaOptions) => Promise<string>;
  readonly prepareSimulator: typeof prepareSimulator;
  readonly freePort: () => Promise<number>;
}

const DEFAULT_DEPS: TvosDriverDeps = {
  runner: defaultRunner,
  createSession: createWebdriverioSession,
  startAppium: startAppiumServer,
  ensureWda: ensurePrebuiltWda,
  prepareSimulator,
  freePort,
};

interface Started {
  readonly session: TvosSession;
  readonly simulator: TvosSimulator;
  readonly simctl: Simctl;
  readonly appium: AppiumServer | undefined;
  readonly logs: AppLogStream | undefined;
  readonly recorder: ScreenRecorder;
}

/**
 * dpad driver for tvOS simulators on Appium XCUITest. One instance drives one simulator for
 * one worker. Every read (`query`, `focused`, `tree`) is a single page source fetch; input is
 * real `XCUIRemote` button presses.
 */
export class TvosDriver implements Driver {
  readonly platform = 'tvos' as const;
  readonly capabilities: ReadonlySet<Capability> = TVOS_CAPABILITIES;

  private readonly app: TvosAppConfig;
  private readonly deps: TvosDriverDeps;
  private started: Started | undefined;
  private stopping: Promise<void> | undefined;

  constructor(
    private readonly options: TvosDriverOptions,
    private readonly ctx: DriverCreateContext,
    deps: Partial<TvosDriverDeps> = {},
  ) {
    this.app = resolveAppConfig(ctx.app);
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.stopping = undefined;
    const { options, ctx, deps } = this;
    const udid = ctx.device?.address ?? options.udid;
    if (!udid) {
      throw tvosError(TvosErrorCode.NO_DEVICE, 'No tvOS simulator to drive.', {
        hint: 'Use the `managed` device provider, lease one through `external`/`command`, or set the `udid` driver option.',
        docs: 'simulators',
      });
    }
    const deviceSet = options.deviceSet ?? deviceSetFromLease(ctx.device);
    const simctl = new Simctl(deviceSet, deps.runner);
    const simulator = await deps.prepareSimulator(udid, { deviceSet, runner: deps.runner });
    await mkdir(ctx.artifactsDir, { recursive: true });

    let appium: AppiumServer | undefined;
    let session: TvosSession | undefined;
    try {
      // Build/locate WDA while Appium boots; keep the server handle even if WDA fails.
      const serverStart = options.appium?.url ? undefined : this.startServer();
      const [wda, server] = await Promise.allSettled([this.wdaPath(), serverStart]);
      if (server.status === 'fulfilled') appium = server.value;
      if (server.status === 'rejected') throw server.reason;
      if (wda.status === 'rejected') throw wda.reason;
      const wdaPath = wda.value;
      const serverUrl = options.appium?.url ?? appium?.url ?? '';
      const capabilities = buildCapabilities({
        simulator,
        wdaLocalPort: await deps.freePort(),
        wdaPath,
        externalServer: options.appium?.url !== undefined,
        extra: options.capabilities,
      });
      const t0 = Date.now();
      session = await this.openSession(serverUrl, capabilities, appium);
      ctx.log(
        `tvOS session on ${simulator.name} (${simulator.osVersion}) ready in ${Date.now() - t0}ms`,
      );

      if (this.app.app) await simctl.exec(['install', simulator.udid, this.app.app]);
      const logs = await this.startLogs(simctl, simulator);
      this.started = {
        session,
        simulator,
        simctl,
        appium,
        logs,
        recorder: new ScreenRecorder(simctl, simulator.udid),
      };
    } catch (err) {
      await session?.deleteSession().catch(() => {});
      await appium?.stop().catch(() => {});
      throw err;
    }
  }

  stop(): Promise<void> {
    this.stopping ??= this.doStop();
    return this.stopping;
  }

  async launch(opts: DriverLaunchOptions): Promise<void> {
    const { bundleId, launchArguments = [], launchEnvironment = {} } = this.app;
    await this.mobile('terminateApp', { bundleId });
    if (opts.clearData) await this.mobile('clearApp', { bundleId });
    await this.mobile('launchApp', {
      bundleId,
      arguments: [...launchArguments, `-${LAUNCH_PARAM}`, encodeLaunchPayload(opts.payload)],
      environment: launchEnvironment,
    });
  }

  async terminate(): Promise<void> {
    await this.mobile('terminateApp', { bundleId: this.app.bundleId });
  }

  /** Clears the app's data container (terminates the app first). */
  async reset(): Promise<void> {
    await this.mobile('clearApp', { bundleId: this.app.bundleId });
  }

  async query(chain: SelectorChain): Promise<readonly ElementSnapshot[]> {
    return queryTree(await this.tree(), chain);
  }

  async focused(): Promise<ElementSnapshot | null> {
    return focusedIn(await this.tree());
  }

  async tree(): Promise<UITree> {
    const source = await this.mobile('source', {
      format: 'json',
      excludedAttributes: SOURCE_EXCLUDED_ATTRIBUTES,
    });
    return parseSource(source as WdaSourceNode);
  }

  async press(key: Key, opts?: PressOptions): Promise<void> {
    const name = REMOTE_BUTTONS[key];
    if (!name) {
      throw tvosError(TvosErrorCode.KEY_UNSUPPORTED, `The Siri Remote has no button for ${key}.`, {
        hint: 'Gate the test with `requires`, or declare an app-level key override (e.g. FAST_FORWARD = hold RIGHT) in your dpad config.',
        docs: 'remote',
      });
    }
    const holdMs = opts?.holdMs ?? 0;
    await this.mobile(
      'pressButton',
      holdMs > 0 ? { name, durationSeconds: holdMs / 1000 } : { name },
    );
  }

  async screenshot(opts?: { readonly element?: ElementRef }): Promise<Uint8Array> {
    const { session } = this.require();
    if (!opts?.element)
      return decodeBase64(await this.call('screenshot', () => session.takeScreenshot()));
    // Resolve the element against the current screen, then crop one viewport screenshot.
    const tree = await this.tree();
    const node = findByRef(tree, opts.element);
    if (!node) {
      throw tvosError(
        TvosErrorCode.ELEMENT_DETACHED,
        `Element ${opts.element} is no longer on screen.`,
        {
          hint: 'Re-resolve the locator; refs are tied to the screen structure they came from.',
          docs: 'traps',
        },
      );
    }
    const png = decodeBase64(await this.call('screenshot', () => session.takeScreenshot()));
    const cropped = node.visible ? cropPng(png, node.bounds, tree.viewport.width) : null;
    if (!cropped) {
      throw tvosError(
        TvosErrorCode.ELEMENT_NOT_VISIBLE,
        `Element ${opts.element} is not visible on screen.`,
        {
          hint: 'Bring it into view (navigate focus to it) before taking its screenshot.',
          docs: 'traps',
        },
      );
    }
    return cropped;
  }

  async drainLogs(): Promise<readonly LogEntry[]> {
    return this.started?.logs?.drain() ?? [];
  }

  async startRecording(): Promise<void> {
    const { recorder } = this.require();
    await recorder.start(
      join(this.ctx.artifactsDir, `tvos-w${this.ctx.workerIndex}-${Date.now()}.mp4`),
    );
  }

  async stopRecording(): Promise<string> {
    return this.require().recorder.stop();
  }

  /** The WebdriverIO `Browser` of the Appium session, for `app.platformOnly('tvos', ...)`. */
  escapeHatch(): unknown {
    return this.require().session;
  }

  private async doStop(): Promise<void> {
    const started = this.started;
    this.started = undefined;
    if (!started) return;
    if (started.recorder.recording) await started.recorder.stop().catch(() => {});
    started.logs?.stop();
    await started.session.deleteSession().catch(() => {});
    await started.appium?.stop().catch(() => {});
  }

  private require(): Started {
    if (!this.started) {
      throw tvosError(TvosErrorCode.NOT_STARTED, 'The tvOS driver is not started.', {
        hint: 'Call start() first; @dpad-tv/test does this per worker.',
      });
    }
    return this.started;
  }

  /** Runs an XCUITest `mobile:` extension command. */
  private async mobile(command: string, args: Record<string, unknown>): Promise<unknown> {
    const { session } = this.require();
    return this.call(command, () => session.execute(`mobile: ${command}`, args));
  }

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (cause) {
      const appiumLog = this.started?.appium?.logFile;
      throw tvosError(TvosErrorCode.COMMAND_FAILED, `tvOS ${what} failed: ${errorMessage(cause)}`, {
        hint: appiumLog
          ? `See the Appium log at ${appiumLog} for details.`
          : 'See the Appium server log for details.',
        docs: 'traps',
        cause,
      });
    }
  }

  private async wdaPath(): Promise<string | undefined> {
    const wda = this.options.wda ?? {};
    if (wda.mode === 'xcodebuild') return undefined;
    if (wda.path) return wda.path;
    return this.deps.ensureWda({
      runner: this.deps.runner,
      log: this.ctx.log,
      ...(wda.cacheDir === undefined ? {} : { cacheDir: wda.cacheDir }),
      ...(wda.buildTimeoutMs === undefined ? {} : { buildTimeoutMs: wda.buildTimeoutMs }),
    });
  }

  private startServer(): Promise<AppiumServer> {
    const a = this.options.appium ?? {};
    return this.deps.startAppium({
      logFile: join(this.ctx.artifactsDir, `appium-w${this.ctx.workerIndex}.log`),
      ...(a.home === undefined ? {} : { home: a.home }),
      ...(a.port === undefined ? {} : { port: a.port }),
      ...(a.args === undefined ? {} : { args: a.args }),
      ...(a.startTimeoutMs === undefined ? {} : { startTimeoutMs: a.startTimeoutMs }),
    });
  }

  private async openSession(
    serverUrl: string,
    capabilities: Record<string, unknown>,
    appium: AppiumServer | undefined,
  ): Promise<TvosSession> {
    try {
      return await this.deps.createSession({
        serverUrl,
        capabilities,
        timeoutMs: this.options.sessionTimeoutMs ?? 300_000,
      });
    } catch (cause) {
      throw tvosError(
        TvosErrorCode.SESSION_FAILED,
        `Could not open an Appium XCUITest session on ${serverUrl}: ${errorMessage(cause)}`,
        {
          hint: appium
            ? `See the Appium log at ${appium.logFile}. WebDriverAgent install/launch problems show up there.`
            : 'Check the log of your Appium server and that the XCUITest driver is installed in it.',
          docs: 'setup',
          cause,
        },
      );
    }
  }

  private async startLogs(
    simctl: Simctl,
    simulator: TvosSimulator,
  ): Promise<AppLogStream | undefined> {
    const logsOpt = this.options.logs ?? {};
    if (logsOpt.enabled === false) return undefined;
    const processName = logsOpt.process ?? (await this.executableName(simctl, simulator.udid));
    const stream = new AppLogStream(simctl, simulator.udid, processName);
    stream.start();
    return stream;
  }

  /** `CFBundleExecutable` of the installed app (the process name its logs carry). */
  private async executableName(simctl: Simctl, udid: string): Promise<string> {
    const bundle = await simctl.appBundlePath(udid, this.app.bundleId);
    if (!bundle) {
      throw tvosError(
        TvosErrorCode.APP_NOT_INSTALLED,
        `${this.app.bundleId} is not installed on simulator ${udid}.`,
        {
          hint: 'Set `app` in the tvOS app config to a simulator .app build so dpad installs it, or install it before the run.',
          docs: 'setup',
        },
      );
    }
    const res = await this.deps.runner.run('plutil', [
      '-extract',
      'CFBundleExecutable',
      'raw',
      '-o',
      '-',
      join(bundle, 'Info.plist'),
    ]);
    const name = res.stdout.trim();
    if (res.exitCode !== 0 || !name) {
      throw tvosError(
        TvosErrorCode.APP_NOT_INSTALLED,
        `Could not read CFBundleExecutable of ${bundle}: ${tail(res.stderr)}`,
        { hint: 'Set the `logs.process` driver option to the app process name.', docs: 'setup' },
      );
    }
    return name;
  }
}

/** Appium capabilities for one tvOS simulator session. `extra` is merged last. */
export function buildCapabilities(input: {
  readonly simulator: TvosSimulator;
  readonly wdaLocalPort: number;
  readonly wdaPath: string | undefined;
  readonly externalServer: boolean;
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}): Record<string, unknown> {
  const { simulator, wdaPath } = input;
  return {
    platformName: 'tvOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': simulator.udid,
    'appium:deviceName': simulator.name,
    ...(simulator.osVersion ? { 'appium:platformVersion': simulator.osVersion } : {}),
    ...(simulator.deviceSet ? { 'appium:simulatorDevicesSetPath': simulator.deviceSet } : {}),
    // Each parallel simulator shares the host network, so WDA needs its own port.
    'appium:wdaLocalPort': input.wdaLocalPort,
    ...(wdaPath ? { 'appium:usePreinstalledWDA': true, 'appium:prebuiltWDAPath': wdaPath } : {}),
    'appium:noReset': true,
    // dpad streams app logs itself, filtered to the app process.
    'appium:skipLogCapture': true,
    // Reads must return the current state immediately; the core owns waiting.
    'appium:waitForIdleTimeout': 0,
    // A server we own dies with the worker; a shared one must reap abandoned sessions.
    'appium:newCommandTimeout': input.externalServer ? 600 : 0,
    ...input.extra,
  };
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}
