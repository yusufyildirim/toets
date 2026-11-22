import type { LaunchPayload, SdkHost, SdkSession } from '@dpad-tv/protocol';
import type {
  App,
  Focus,
  LaunchOptions,
  Locator,
  Media,
  Network,
  PlatformEvent,
  PlatformInfo,
  RecordedRequest,
  Remote,
  Screenshot,
  ScreenshotOptions,
} from '../api.js';
import type { Capability } from '../capabilities.js';
import type { Driver } from '../driver.js';
import { DpadError, docsLink, fromProtocolError } from '../errors.js';
import type { MockServerLike } from '../mock.js';
import type { Platform } from '../platform.js';
import type { LogEntry, Rect } from '../snapshot.js';
import type { CapturedScreen, KeyLogEntry, RuntimeContext } from './context.js';
import { MediaImpl, NetworkImpl, PlatformInfoImpl } from './domains.js';
import type { FailureDump } from './failure-dump.js';
import { FocusImpl } from './focus.js';
import { createLocator, describeElement, locatorImpl } from './locator.js';
import {
  DEFAULT_IDLE,
  DEFAULT_REMOTE,
  DEFAULT_TIMEOUTS,
  DIRECT_HOOKS,
  type ActionHooks,
  type ActionInfo,
  type AppRuntimeOptions,
  type IdleOptions,
  type KeyOverrides,
  type RemoteOptions,
  type Timeouts,
} from './options.js';
import { RemoteImpl } from './remote.js';
import { describeIdle, retry, type RetryResult } from './retry.js';
import { createScreenshot, maskPng } from './screenshot.js';
import { DOMAIN_CAPABILITIES, SDK_CAPABILITIES, Target } from './target.js';
import { renderTextSnapshot } from './text-snapshot.js';

const KEY_LOG_SIZE = 20;
const LOG_BUFFER_SIZE = 1000;
const DUMP_LOGS = 50;
const DUMP_REQUESTS = 20;

const SDK_DOMAIN_OF: Partial<Record<Capability, string>> = Object.fromEntries(
  Object.entries(DOMAIN_CAPABILITIES).flatMap(([domain, caps]) => caps.map((c) => [c, domain])),
);

/**
 * Runs one app under test on one target. Owns the driver composition, SDK session, key log and
 * logs; exposes the authoring API as {@link AppRuntime.app}. Runners (`@dpad-tv/test`, the MCP
 * server) create one per worker and call {@link AppRuntime.isolate} between tests.
 */
export class AppRuntime implements RuntimeContext {
  /** The authoring API handed to tests. */
  readonly app: App;
  readonly target: Target;
  readonly mock: MockServerLike | undefined;
  readonly sdkHost: SdkHost | undefined;
  readonly timeouts: Timeouts;
  readonly idle: IdleOptions;
  readonly remote: RemoteOptions;
  readonly keyOverrides: KeyOverrides;

  private currentHooks: ActionHooks;
  private readonly sink: ((message: string) => void) | undefined;
  private keys: KeyLogEntry[] = [];
  private logBuffer: LogEntry[] = [];
  private launched = false;
  /** Set by `platform.emit('network-lost')` until restored; `isolate()` restores it. */
  private networkLost = false;
  private unsubscribeLogs: (() => void) | null = null;

  constructor(opts: AppRuntimeOptions) {
    this.sink = opts.log;
    this.target = new Target(opts.driver, {
      idleQuietMs: opts.idle?.quietMs ?? DEFAULT_IDLE.quietMs,
      log: (m) => this.log(m),
    });
    this.mock = opts.mock;
    this.sdkHost = opts.sdkHost;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
    this.idle = { ...DEFAULT_IDLE, ...opts.idle };
    this.remote = { ...DEFAULT_REMOTE, ...opts.remote };
    this.keyOverrides = opts.keyOverrides ?? {};
    this.currentHooks = opts.hooks ?? DIRECT_HOOKS;
    this.app = new AppImpl(this);
  }

  get driver(): Driver {
    return this.target.driver;
  }

  get hooks(): ActionHooks {
    return this.currentHooks;
  }

  /** Replaces the action hooks (a runner sets per-test hooks). */
  setHooks(hooks: ActionHooks | undefined): void {
    this.currentHooks = hooks ?? DIRECT_HOOKS;
  }

  /** Capabilities right now: driver, connected SDK domains and the mock server. */
  get capabilities(): ReadonlySet<Capability> {
    return this.app.platform.capabilities;
  }

  /**
   * Capabilities this target is configured to have, known before any launch: the driver's,
   * every SDK capability when the SDK is enabled, and `network.mock` when mocking is on. Used
   * for `requires` checks, which run before the app connects.
   */
  get declaredCapabilities(): ReadonlySet<Capability> {
    const caps = new Set(this.driver.capabilities);
    if (this.sdkHost) SDK_CAPABILITIES.forEach((c) => caps.add(c));
    if (this.mock) caps.add('network.mock');
    return caps;
  }

  /** Recent key presses, oldest first. */
  get keyLog(): readonly KeyLogEntry[] {
    return this.keys;
  }

  get isLaunched(): boolean {
    return this.launched;
  }

  /** Runs an action as a step. SDK protocol errors escaping it surface as `DpadError`. */
  step<T>(info: ActionInfo, run: () => Promise<T>): Promise<T> {
    return this.currentHooks.step(info, () =>
      run().catch((e: unknown) => {
        throw fromProtocolError(e);
      }),
    );
  }

  retry<T>(
    evaluate: () => Promise<{ readonly ok: boolean; readonly value: T }>,
    timeoutMs: number,
  ): Promise<RetryResult<T>> {
    return retry(this.target, evaluate, { timeoutMs, idleBudgetMs: this.idle.budgetMs });
  }

  requireCapability(capability: Capability, feature: string): void {
    if (this.capabilities.has(capability)) return;
    const platform = this.driver.platform;
    const domain = SDK_DOMAIN_OF[capability];
    const session = this.target.sdk;
    let hint: string;
    if (domain && this.sdkHost && !session) {
      hint = 'The SDK is enabled but no app is connected: call app.launch() first.';
    } else if (domain && session) {
      hint = `The connected SDK (${session.hello.sdk}) does not announce the '${domain}' domain. Implement it in the app's SDK integration, or declare requires('${capability}') to skip where it is missing.`;
    } else if (domain) {
      hint = `It comes from the in-app SDK '${domain}' domain: enable dpad.sdk and integrate the SDK, or declare requires('${capability}') to skip the test where it is missing.`;
    } else {
      hint = `Declare requires('${capability}') on the test so it is skipped on platforms without it.`;
    }
    throw new DpadError(
      'CAPABILITY_MISSING',
      `${feature} needs capability '${capability}', which ${platform} does not have here.`,
      { hint, docs: docsLink('core/capabilities') },
    );
  }

  recordKey(entry: KeyLogEntry): void {
    this.keys.push(entry);
    if (this.keys.length > KEY_LOG_SIZE) this.keys.shift();
  }

  recordEvent(event: PlatformEvent): void {
    if (event === 'network-lost') this.networkLost = true;
    else if (event === 'network-restored') this.networkLost = false;
  }

  log(message: string): void {
    this.pushLog({ level: 'debug', message, timestamp: Date.now(), source: 'driver' });
    this.sink?.(message);
  }

  private pushLog(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > LOG_BUFFER_SIZE) this.logBuffer.shift();
  }

  async captureScreen(opts?: ScreenshotOptions): Promise<CapturedScreen> {
    const [png, tree] = await Promise.all([this.driver.screenshot(), this.target.tree()]);
    const rects: Rect[] = [];
    for (const mask of opts?.mask ?? []) {
      const impl = locatorImpl(mask);
      if (!impl) {
        throw new DpadError('INVALID_ARGUMENT', 'screenshot({ mask }) takes dpad Locators.', {
          docs: docsLink('core/screenshots'),
        });
      }
      for (const el of await impl.resolve()) if (el.visible) rects.push(el.bounds);
    }
    const width = tree.viewport.width;
    return { png: maskPng(png, rects, width), viewportWidth: width };
  }

  async launch(opts: LaunchOptions = {}): Promise<void> {
    const wantsState = opts.state !== undefined || opts.flags !== undefined;
    const parts = ['launch'];
    if (opts.state !== undefined) parts.push(`state=${opts.state}`);
    if (opts.flags !== undefined) parts.push(`flags=${JSON.stringify(opts.flags)}`);
    if (opts.clearData) parts.push('clearData');
    await this.step({ kind: 'launch', title: parts.join(' ') }, async () => {
      if (wantsState && !this.sdkHost)
        this.requireCapability('app.state', 'launch({ state, flags })');
      await this.closeSession();
      const token = this.sdkHost?.issueToken();
      const payload: LaunchPayload = {
        v: 1,
        ...(this.sdkHost && token ? { sdkUrl: this.sdkHost.url, token } : {}),
        ...(this.mock ? { mockUrl: this.mock.url } : {}),
        ...(opts.state !== undefined ? { state: opts.state } : {}),
        ...(opts.flags !== undefined ? { flags: opts.flags } : {}),
      };
      await this.driver.launch({ payload, ...(opts.clearData ? { clearData: true } : {}) });
      this.launched = true;
      if (this.sdkHost && token) {
        this.attach(await this.connect(this.sdkHost, token));
        if (wantsState) this.requireCapability('app.state', 'launch({ state, flags })');
      }
    });
  }

  private async connect(host: SdkHost, token: string): Promise<SdkSession> {
    const timeoutMs = this.timeouts.sdkConnectMs;
    try {
      return await host.waitForSession(token, { timeoutMs });
    } catch (cause) {
      throw new DpadError(
        'SDK_NOT_CONNECTED',
        `The app did not connect to the dpad SDK host at ${host.url} within ${timeoutMs}ms.`,
        {
          hint: 'Check that the app includes the dpad SDK and starts it at launch, that it reads the launch payload (__dpad), and that the device can reach the host (drivers set up adb reverse on Android). For black-box runs, disable dpad.sdk.',
          docs: docsLink('core/sdk'),
          cause,
        },
      );
    }
  }

  private attach(session: SdkSession): void {
    this.target.attach(session);
    this.unsubscribeLogs = session.on('logs.entry', (entry) =>
      this.pushLog({ ...entry, source: 'app' }),
    );
  }

  private async closeSession(): Promise<void> {
    const session = this.target.sdk;
    this.unsubscribeLogs?.();
    this.unsubscribeLogs = null;
    if (!session) return;
    this.target.detach(session);
    try {
      await session.close();
    } catch (e) {
      this.log(`closing the SDK session failed: ${String(e)}`);
    }
  }

  async terminate(): Promise<void> {
    await this.step({ kind: 'terminate', title: 'terminate' }, async () => {
      await this.closeSession();
      await this.driver.terminate();
      this.launched = false;
    });
  }

  async reset(): Promise<void> {
    await this.step({ kind: 'reset', title: 'reset' }, async () => {
      await this.closeSession();
      await this.driver.reset();
    });
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Screenshot> {
    return createScreenshot((await this.captureScreen(opts)).png);
  }

  async snapshot(): Promise<string> {
    return renderTextSnapshot(await this.target.tree());
  }

  async platformOnly(platform: Platform, fn: (handle: unknown) => Promise<void>): Promise<void> {
    if (this.driver.platform !== platform) return;
    await this.step({ kind: 'platformOnly', title: `platformOnly ${platform}` }, () =>
      fn(this.driver.escapeHatch()),
    );
  }

  /** Moves logs reported by the driver and the SDK into the buffer. */
  private async drainLogs(): Promise<void> {
    try {
      for (const entry of await this.driver.drainLogs()) this.pushLog(entry);
    } catch (e) {
      this.log(`draining driver logs failed: ${String(e)}`);
    }
  }

  /** Logs since the last call (driver, app via SDK, dpad debug messages), oldest first. */
  async takeLogs(): Promise<readonly LogEntry[]> {
    await this.drainLogs();
    const out = this.logBuffer;
    this.logBuffer = [];
    return out;
  }

  /**
   * Returns the target to a neutral state between tests that do not share the app: terminates a
   * launched app, closes the SDK session, restores a network a test took down, resets mock
   * handlers and clears recorded requests, the key log and logs.
   */
  async isolate(): Promise<void> {
    await this.closeSession();
    if (this.launched) {
      try {
        await this.driver.terminate();
      } catch (e) {
        this.log(`terminating the app between tests failed: ${String(e)}`);
      }
      this.launched = false;
    }
    if (this.networkLost) {
      this.networkLost = false;
      try {
        await this.driver.emit?.('network-restored');
      } catch (e) {
        this.log(`restoring the network between tests failed: ${String(e)}`);
      }
    }
    this.mock?.resetHandlers();
    this.mock?.clearRequests();
    this.keys = [];
    await this.takeLogs();
  }

  /** Collects a failure dump. Never throws. */
  async failureDump(): Promise<FailureDump> {
    const unavailable = (e: unknown) =>
      `unavailable: ${e instanceof Error ? e.message : String(e)}`;
    const session = this.target.sdk;
    const [focused, screen, screenshot, idle] = await Promise.all([
      this.target.focused().then(describeElement, unavailable),
      this.snapshot().catch(unavailable),
      this.driver.screenshot().catch(() => null),
      this.target.waitForIdle(250).catch(() => ({ supported: false }) as const),
    ]);
    await this.drainLogs();
    let requests: FailureDump['requests'] = [];
    try {
      requests = dumpRequests(this.mock?.requests() ?? []);
    } catch (e) {
      this.log(`reading recorded requests failed: ${String(e)}`);
    }
    return {
      platform: this.driver.platform,
      capabilities: [...this.capabilities].sort(),
      sdk: session
        ? {
            connected: true,
            sdk: session.hello.sdk,
            framework: session.hello.framework,
            domains: [...session.domains].sort(),
          }
        : { connected: false, enabled: !!this.sdkHost },
      focused,
      screen,
      busy:
        idle.supported && !idle.idle
          ? describeIdle({ kind: 'busy', budgetMs: 250, busy: idle.busy })
          : null,
      lastKeys: [...this.keys],
      logs: this.logBuffer.slice(-DUMP_LOGS),
      requests,
      screenshot,
    };
  }

  /** Terminates the app and closes the SDK session. The driver itself is the runner's to stop. */
  async dispose(): Promise<void> {
    await this.closeSession();
    if (this.launched) {
      this.launched = false;
      await this.driver
        .terminate()
        .catch((e: unknown) => this.log(`terminate failed: ${String(e)}`));
    }
  }
}

/** The public `App` facade over a runtime. */
class AppImpl implements App {
  readonly platform: PlatformInfo;
  readonly remote: Remote;
  readonly focus: Focus;
  readonly media: Media;
  readonly network: Network;

  constructor(readonly runtime: AppRuntime) {
    const remote = new RemoteImpl(runtime);
    this.remote = remote;
    this.focus = new FocusImpl(runtime, remote);
    this.media = new MediaImpl(runtime);
    this.network = new NetworkImpl(runtime);
    this.platform = new PlatformInfoImpl(runtime);
  }

  launch(opts?: LaunchOptions): Promise<void> {
    return this.runtime.launch(opts);
  }

  terminate(): Promise<void> {
    return this.runtime.terminate();
  }

  reset(): Promise<void> {
    return this.runtime.reset();
  }

  getByTestId(testId: string): Locator {
    return createLocator(this.runtime, [{ kind: 'testId', value: testId }]);
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return createLocator(this.runtime, [
      opts?.exact === undefined
        ? { kind: 'text', value: text }
        : { kind: 'text', value: text, exact: opts.exact },
    ]);
  }

  screenshot(opts?: ScreenshotOptions): Promise<Screenshot> {
    return this.runtime.screenshot(opts);
  }

  snapshot(): Promise<string> {
    return this.runtime.snapshot();
  }

  platformOnly(platform: Platform, fn: (handle: unknown) => Promise<void>): Promise<void> {
    return this.runtime.platformOnly(platform, fn);
  }
}

/** The runtime behind an `App`, or `null` for anything else. */
export function appRuntime(value: unknown): AppRuntime | null {
  return value instanceof AppImpl ? value.runtime : null;
}

/**
 * The requests a failure dump shows: the last {@link DUMP_REQUESTS}, plus earlier failed ones
 * (often the cause), in arrival order.
 */
function dumpRequests(all: readonly RecordedRequest[]): readonly RecordedRequest[] {
  const recent = Math.max(0, all.length - DUMP_REQUESTS);
  const picked = all.filter((r, i) => i >= recent || r.error);
  return picked.slice(-2 * DUMP_REQUESTS);
}
