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
import { encodeLaunchPayload, LAUNCH_PARAM, type LaunchPayload } from '@dpad-tv/protocol';
import { join } from 'node:path';
import { Adb, type LaunchTarget } from './adb.js';
import {
  externalAppiumServer,
  freePort,
  startAppiumServer,
  type AppiumServer,
  type StartAppiumOptions,
} from './appium.js';
import { nodeCommandRunner, type CommandRunner } from './command.js';
import { DOCS, androidError } from './errors.js';
import { KeyHolder } from './key-hold.js';
import { ANDROID_KEYCODES, REMOTE_PROFILE_CAPABILITIES, keySupported } from './keys.js';
import { LogcatCollector } from './logcat.js';
import { parseAppConfig, type AndroidTvAppConfig, type AndroidTvDriverOptions } from './options.js';
import { findByRef, parsePageSource } from './page-source.js';
import { cropPng } from './png.js';
import { findFocused, queryTree } from './query.js';
import { ScreenRecorder } from './recorder.js';
import { resolveAndroidSdk } from './sdk.js';

/**
 * The part of a WebdriverIO `Browser` the driver uses. Narrow on purpose: everything else
 * (launch, reset, logs, video, long press) goes through adb, which is faster and testable.
 */
export interface AppiumSession {
  getPageSource(): Promise<string>;
  takeScreenshot(): Promise<string>;
  execute(script: string, ...args: unknown[]): Promise<unknown>;
  updateSettings(settings: Record<string, unknown>): Promise<unknown>;
  deleteSession(): Promise<unknown>;
}

/** Seams for unit tests. Production code uses the defaults. */
export interface AndroidTvDriverDeps {
  readonly runner?: CommandRunner;
  readonly env?: NodeJS.ProcessEnv;
  readonly startServer?: (opts: StartAppiumOptions) => Promise<AppiumServer>;
  readonly createSession?: (
    server: AppiumServer,
    capabilities: Record<string, unknown>,
  ) => Promise<AppiumSession>;
}

/**
 * UiAutomator2 settings applied to every session. `waitForIdleTimeout: 0` stops UiAutomator
 * from waiting for the UI to idle before each command (dpad retries in the core instead, and
 * TV screens with video or animations may never idle); invisible elements are included so
 * `visible: false` can be reported instead of the element vanishing.
 */
export const DEFAULT_UIA2_SETTINGS: Readonly<Record<string, unknown>> = {
  waitForIdleTimeout: 0,
  allowInvisibleElements: true,
  ignoreUnimportantViews: false,
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The Android TV / Fire TV driver: Appium UiAutomator2 for UI state and key presses, adb for
 * app lifecycle, port reversing, logs, video and key holds. One instance per worker and device.
 */
export class AndroidTvDriver implements Driver {
  readonly platform = 'android-tv' as const;
  readonly capabilities: ReadonlySet<Capability>;
  readonly adb: Adb;
  readonly app: AndroidTvAppConfig;

  private readonly runner: CommandRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logcat: LogcatCollector | undefined;
  private readonly recorder: ScreenRecorder;
  private readonly keyHolder: KeyHolder;
  private readonly reversedPorts = new Set<number>();
  private readonly driverLogs: LogEntry[] = [];
  private launchTarget: LaunchTarget | undefined;
  private server: AppiumServer | undefined;
  private session: AppiumSession | undefined;
  private started: Promise<void> | undefined;

  constructor(
    private readonly options: AndroidTvDriverOptions,
    private readonly ctx: DriverCreateContext,
    serial: string,
    adbPath: string,
    private readonly deps: AndroidTvDriverDeps = {},
  ) {
    this.runner = deps.runner ?? nodeCommandRunner;
    this.env = deps.env ?? process.env;
    this.app = parseAppConfig(ctx.app);
    this.adb = new Adb(this.runner, adbPath, serial, this.env);
    this.capabilities = new Set<Capability>([
      ...REMOTE_PROFILE_CAPABILITIES[options.remote ?? 'android-tv'],
      'key.longpress',
      'screenshot.element',
      'network.mock',
      'video',
      ...(options.logcat === false ? [] : (['logs'] as const)),
    ]);
    this.logcat =
      options.logcat === false
        ? undefined
        : new LogcatCollector(this.adb, {
            scope: options.logcat ?? 'app',
            packageName: this.app.package,
          });
    this.recorder = new ScreenRecorder(this.adb, {
      outputDir: ctx.artifactsDir,
      runner: this.runner,
      log: (m) => this.note('info', m),
      ...(options.video?.bitRate ? { bitRate: options.video.bitRate } : {}),
      ...(options.video?.ffmpeg ? { ffmpeg: options.video.ffmpeg } : {}),
    });
    this.keyHolder = new KeyHolder(this.adb);
  }

  get serial(): string {
    return this.adb.serial;
  }

  start(): Promise<void> {
    this.started ??= this.doStart().catch(async (e: unknown) => {
      this.started = undefined;
      await this.stop();
      throw e;
    });
    return this.started;
  }

  private async doStart(): Promise<void> {
    await this.adb.waitForBoot(this.options.bootTimeoutMs ?? 180_000);
    const isTv = (
      await this.adb.shell(['pm', 'has-feature', 'android.software.leanback']).catch(() => '')
    ).includes('true');
    if (!isTv)
      this.note('warn', `${this.serial} is not an Android TV device (no leanback feature).`);

    if (this.app.apk) await this.adb.install(this.app.apk);
    if (!(await this.adb.isInstalled(this.app.package))) {
      throw androidError(
        'ANDROID_APP_NOT_INSTALLED',
        `${this.app.package} is not installed on ${this.serial}.`,
        {
          hint: 'Set `app.apk` so dpad installs it, or install it before the run.',
          docs: DOCS.setup,
        },
      );
    }
    this.launchTarget = await this.resolveLaunchTarget();
    if (this.logcat) {
      this.logcat.setAppUid(await this.adb.appUid(this.app.package));
      this.logcat.start();
    }

    const appium = this.options.appium ?? {};
    this.server = appium.url
      ? externalAppiumServer(appium.url)
      : await (this.deps.startServer ?? startAppiumServer)({
          runner: this.runner,
          env: {
            ...this.env,
            ANDROID_HOME: resolveAndroidSdk(this.options.sdkRoot, this.env).root,
          },
          logFile: join(this.ctx.artifactsDir, `appium-${this.ctx.workerIndex}.log`),
          log: this.ctx.log,
          ...(appium.port ? { port: appium.port } : {}),
        });
    const capabilities = {
      ...(await this.sessionCapabilities()),
      ...appium.capabilities,
    };
    try {
      this.session = await (this.deps.createSession ?? createWebdriverSession)(
        this.server,
        capabilities,
      );
    } catch (e) {
      throw androidError(
        'ANDROID_SESSION_FAILED',
        `Could not open a UiAutomator2 session on ${this.serial}: ${(e as Error).message}`,
        {
          hint: appium.url
            ? 'Check that the Appium server at appium.url has the uiautomator2 driver installed.'
            : `See the Appium log in ${this.ctx.artifactsDir}.`,
          docs: DOCS.setup,
          cause: e,
        },
      );
    }
    await this.session.updateSettings({ ...DEFAULT_UIA2_SETTINGS, ...appium.settings });
  }

  private async sessionCapabilities(): Promise<Record<string, unknown>> {
    const adbPort = Number(this.env.ANDROID_ADB_SERVER_PORT);
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': this.serial,
      'appium:noReset': true,
      'appium:autoLaunch': false,
      'appium:skipUnlock': true,
      'appium:skipLogcatCapture': true,
      'appium:newCommandTimeout': 600,
      'appium:uiautomator2ServerLaunchTimeout': 120_000,
      'appium:uiautomator2ServerInstallTimeout': 120_000,
      // Explicit per-worker port: the driver's own pick races between parallel servers.
      'appium:systemPort': await freePort(),
      ...(adbPort > 0 ? { 'appium:adbPort': adbPort } : {}),
    };
  }

  private async resolveLaunchTarget(): Promise<LaunchTarget> {
    const { activity } = this.app;
    if (activity) {
      const component = activity.includes('/') ? activity : `${this.app.package}/${activity}`;
      return { component, action: 'android.intent.action.MAIN' };
    }
    const resolved = await this.adb.resolveLauncher(this.app.package);
    if (!resolved) {
      throw androidError(
        'ANDROID_APP_CONFIG',
        `${this.app.package} has no launcher activity (LEANBACK_LAUNCHER or LAUNCHER).`,
        { hint: 'Set `app.activity` to the activity dpad should start.', docs: DOCS.setup },
      );
    }
    return resolved;
  }

  async stop(): Promise<void> {
    const errors: unknown[] = [];
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        errors.push(e);
      }
    };
    const session = this.session;
    const server = this.server;
    this.session = undefined;
    this.server = undefined;
    this.started = undefined;
    if (this.recorder.recording) await attempt(() => this.recorder.stop());
    if (session) await attempt(() => session.deleteSession());
    if (server) await attempt(() => server.stop());
    if (this.logcat) await attempt(() => this.logcat!.stop());
    for (const port of this.reversedPorts) await attempt(() => this.adb.removeReverse(port));
    this.reversedPorts.clear();
    for (const e of errors) this.ctx.log(`android-tv: cleanup error: ${(e as Error).message}`);
  }

  async launch(opts: DriverLaunchOptions): Promise<void> {
    const target = this.requireTarget();
    await this.adb.forceStop(this.app.package);
    if (opts.clearData) await this.adb.clearData(this.app.package);
    for (const port of payloadPorts(opts.payload)) {
      if (this.reversedPorts.has(port)) continue;
      await this.adb.reverse(port);
      this.reversedPorts.add(port);
    }
    await this.adb.startActivity(target, { [LAUNCH_PARAM]: encodeLaunchPayload(opts.payload) });
  }

  async terminate(): Promise<void> {
    await this.adb.forceStop(this.app.package);
  }

  async reset(): Promise<void> {
    // `pm clear` also stops the app.
    await this.adb.clearData(this.app.package);
  }

  async query(chain: SelectorChain): Promise<readonly ElementSnapshot[]> {
    return queryTree((await this.tree()).root, chain);
  }

  async focused(): Promise<ElementSnapshot | null> {
    return findFocused((await this.tree()).root);
  }

  /** One page-source round trip; `query` and `focused` are computed from it on the host. */
  async tree(): Promise<UITree> {
    const source = await this.requireSession().getPageSource();
    return parsePageSource(
      source,
      this.options.testIdAttribute ? { testIdAttribute: this.options.testIdAttribute } : {},
    );
  }

  async press(key: Key, opts?: PressOptions): Promise<void> {
    if (!keySupported(key, this.capabilities)) {
      throw androidError(
        'ANDROID_KEY_UNSUPPORTED',
        `Key ${key} is not available on the '${this.options.remote ?? 'android-tv'}' remote.`,
        { hint: 'Gate the test with `requires` or change `remote`.', docs: DOCS.keys },
      );
    }
    const keycode = ANDROID_KEYCODES[key];
    if (opts?.holdMs !== undefined) {
      await this.keyHolder.hold(keycode, opts.holdMs);
      return;
    }
    await this.requireSession().execute('mobile: pressKey', { keycode });
  }

  async screenshot(opts: { readonly element?: ElementRef } = {}): Promise<Uint8Array> {
    const session = this.requireSession();
    if (!opts.element) return decodeBase64(await session.takeScreenshot());
    const node = findByRef((await this.tree()).root, opts.element);
    if (!node) {
      throw androidError('ANDROID_ELEMENT_DETACHED', 'The element is no longer on screen.', {
        hint: 'Take element screenshots through a locator so the element is resolved again.',
      });
    }
    const cropped = cropPng(decodeBase64(await session.takeScreenshot()), node.bounds);
    if (!cropped) {
      throw androidError('ANDROID_ELEMENT_DETACHED', 'The element has no visible area.', {
        hint: 'Scroll or navigate until the element is on screen.',
        docs: DOCS.traps,
      });
    }
    return cropped;
  }

  async drainLogs(): Promise<readonly LogEntry[]> {
    const out = [...this.driverLogs, ...(this.logcat?.drain() ?? [])];
    this.driverLogs.length = 0;
    return out.sort((a, b) => a.timestamp - b.timestamp);
  }

  async startRecording(): Promise<void> {
    await this.recorder.start();
  }

  async stopRecording(): Promise<string> {
    return this.recorder.stop();
  }

  /** The WebdriverIO `Browser` (Appium UiAutomator2 session) for `app.platformOnly`. */
  escapeHatch(): unknown {
    return this.requireSession();
  }

  private requireSession(): AppiumSession {
    if (!this.session) throw notStarted();
    return this.session;
  }

  private requireTarget(): LaunchTarget {
    if (!this.launchTarget) throw notStarted();
    return this.launchTarget;
  }

  private note(level: LogEntry['level'], message: string): void {
    this.ctx.log(`android-tv: ${message}`);
    this.driverLogs.push({ level, message, timestamp: Date.now(), source: 'driver' });
  }
}

/** Creates the driver for the device in `ctx.device` (or `options.serial` / `ANDROID_SERIAL`). */
export function createAndroidTvDriver(
  options: AndroidTvDriverOptions,
  ctx: DriverCreateContext,
  deps: AndroidTvDriverDeps = {},
): AndroidTvDriver {
  const env = deps.env ?? process.env;
  const serial = ctx.device?.address ?? options.serial ?? env.ANDROID_SERIAL;
  if (!serial) {
    throw androidError('ANDROID_NO_DEVICE', 'No Android device to run on.', {
      hint: 'Use the `managed` device provider, or pass a serial (DPAD_DEVICES, `serial` option or ANDROID_SERIAL).',
      docs: DOCS.devices,
    });
  }
  const sdk = resolveAndroidSdk(options.sdkRoot, env);
  return new AndroidTvDriver(options, ctx, serial, sdk.adb, deps);
}

/** Ports to `adb reverse` so the payload's `localhost` URLs reach the host. */
export function payloadPorts(payload: LaunchPayload): number[] {
  const ports = new Set<number>();
  for (const raw of [payload.sdkUrl, payload.mockUrl]) {
    if (!raw) continue;
    const url = new URL(raw);
    if (!LOCAL_HOSTS.has(url.hostname)) continue;
    const port =
      Number(url.port) || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80);
    ports.add(port);
  }
  return [...ports];
}

async function createWebdriverSession(
  server: AppiumServer,
  capabilities: Record<string, unknown>,
): Promise<AppiumSession> {
  const { remote } = await import('webdriverio');
  const browser = await remote({
    hostname: server.hostname,
    port: server.port,
    path: '/',
    logLevel: 'error',
    connectionRetryCount: 0,
    connectionRetryTimeout: 300_000,
    capabilities: capabilities as WebdriverIO.Capabilities,
  });
  return browser as unknown as AppiumSession;
}

function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function notStarted() {
  return androidError('ANDROID_NOT_STARTED', 'The Android TV driver is not started.', {
    hint: 'Call `start()` first (the dpad runner does this for you).',
  });
}
