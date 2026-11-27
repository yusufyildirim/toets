import type { LaunchPayload, SdkHost, SdkSession } from '@toets/protocol';
import type {
  App,
  Focus,
  Keyboard,
  KeyboardDefinition,
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
import type { Driver, TranslatedDeepLink } from '../driver.js';
import { ToetsError, packageDocsLink, fromProtocolError } from '../errors.js';
import type { Key, PressOptions } from '../keys.js';
import type { MockServerLike } from '../mock.js';
import type { Platform } from '../platform.js';
import type { LogEntry, Rect } from '../snapshot.js';
import type { CapturedScreen, KeyLogEntry, RuntimeContext } from './context.js';
import { MediaImpl, NetworkImpl, PlatformInfoImpl } from './domains.js';
import type { FailureDump } from './failure-dump.js';
import { FocusImpl } from './focus.js';
import { checkKeyboards, KeyboardImpl, TextEntry } from './keyboard.js';
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
import { keyError, RemoteImpl } from './remote.js';
import { describeIdle, retry, type RetryResult } from './retry.js';
import { createScreenshot, maskPng } from './screenshot.js';
import { DOMAIN_CAPABILITIES, SDK_CAPABILITIES, Target } from './target.js';
import { renderTextSnapshot } from './text-snapshot.js';

const KEY_LOG_SIZE = 20;
const LOG_BUFFER_SIZE = 1000;
const DUMP_LOGS = 50;
const DUMP_REQUESTS = 20;

const DEEP_LINK_DOCS = packageDocsLink('core', 'deep-links');

/** A deep link checked and translated before its step starts; `error` is thrown inside it. */
interface DeepLinkPlan {
  /** `myapp://details/42 → intent com.example.PLAY extras { id: "42" }`, or the link alone. */
  readonly text: string;
  readonly link?: TranslatedDeepLink;
  readonly error?: unknown;
}

const SDK_DOMAIN_OF: Partial<Record<Capability, string>> = Object.fromEntries(
  Object.entries(DOMAIN_CAPABILITIES).flatMap(([domain, caps]) => caps.map((c) => [c, domain])),
);

/**
 * Runs one app under test on one target. Owns the driver composition, SDK session, key log and
 * logs; exposes the authoring API as {@link AppRuntime.app}. Runners (`@toets/test`, the MCP
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
  private currentKeyboards: readonly KeyboardDefinition[];
  private readonly sink: ((message: string) => void) | undefined;
  private keys: KeyLogEntry[] = [];
  private logBuffer: LogEntry[] = [];
  private launched = false;
  /** Title of the last launch, for failure dumps. */
  private lastLaunch: string | null = null;
  /** Title of the last `openDeepLink` since that launch, for failure dumps. */
  private lastDeepLink: string | null = null;
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
    this.currentKeyboards = checkKeyboards(opts.keyboards);
    this.app = new AppImpl(this);
  }

  get driver(): Driver {
    return this.target.driver;
  }

  get hooks(): ActionHooks {
    return this.currentHooks;
  }

  get keyboards(): readonly KeyboardDefinition[] {
    return this.currentKeyboards;
  }

  /**
   * Replaces the declared app keyboards (a runner sets them per test). Validates them:
   * `INVALID_ARGUMENT`, `DUPLICATE_KEYBOARD`.
   */
  setKeyboards(keyboards: readonly KeyboardDefinition[] | undefined): void {
    this.currentKeyboards = checkKeyboards(keyboards);
  }

  get textEntry(): TextEntry {
    return (this.app as AppImpl).textEntry;
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

  /** Step title of the last launch, with its deep link and translation; `null` before one. */
  get lastLaunchTitle(): string | null {
    return this.lastLaunch;
  }

  /** Step title of the last `openDeepLink` since the last launch, with its translation. */
  get lastDeepLinkTitle(): string | null {
    return this.lastDeepLink;
  }

  /** Runs an action as a step. SDK protocol errors escaping it surface as `ToetsError`. */
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
      hint = `It comes from the in-app SDK '${domain}' domain: enable toets.sdk and integrate the SDK, or declare requires('${capability}') to skip the test where it is missing.`;
    } else {
      hint = `Declare requires('${capability}') on the test so it is skipped on platforms without it.`;
    }
    throw new ToetsError(
      'CAPABILITY_MISSING',
      `${feature} needs capability '${capability}', which ${platform} does not have here.`,
      { hint, docs: packageDocsLink('core', 'capabilities') },
    );
  }

  /**
   * Why pressing `key` would fail on this target right now (unknown key, missing capability,
   * no long press), after key overrides; `null` when the press would be sent. Tools use it to
   * list the keys a target has without pressing them.
   */
  checkKey(key: Key, opts?: PressOptions): ToetsError | null {
    return keyError(this, key, opts);
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
        throw new ToetsError('INVALID_ARGUMENT', 'screenshot({ mask }) takes toets Locators.', {
          docs: packageDocsLink('core', 'screenshots'),
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
    const deepLink =
      opts.deepLink === undefined
        ? undefined
        : this.planDeepLink(opts.deepLink, 'deeplink.launch', 'launch({ deepLink })');
    if (deepLink) parts.push(`(deepLink: ${deepLink.text})`);
    const title = parts.join(' ');
    await this.step({ kind: 'launch', title }, async () => {
      if (deepLink?.error !== undefined) throw deepLink.error;
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
      this.lastLaunch = title;
      this.lastDeepLink = null;
      await this.driver.launch({
        payload,
        ...(opts.clearData ? { clearData: true } : {}),
        ...(deepLink?.link ? { deepLink: deepLink.link } : {}),
      });
      this.launched = true;
      if (this.sdkHost && token) {
        this.attach(await this.connect(this.sdkHost, token, deepLink !== undefined));
        if (wantsState) this.requireCapability('app.state', 'launch({ state, flags })');
      }
    });
  }

  async openDeepLink(url: string): Promise<void> {
    const deepLink = this.planDeepLink(url, 'deeplink.open', 'app.openDeepLink()');
    const title = `openDeepLink ${deepLink.text}`;
    await this.step({ kind: 'openDeepLink', title }, async () => {
      if (deepLink.error !== undefined) throw deepLink.error;
      if (!this.launched) {
        throw new ToetsError(
          'APP_NOT_LAUNCHED',
          `openDeepLink(${JSON.stringify(url)}) needs a running app, and it is not launched.`,
          {
            hint: 'Call app.launch() first. To start the app from the link (a cold start), use app.launch({ deepLink }).',
            docs: DEEP_LINK_DOCS,
          },
        );
      }
      const open = this.driver.deepLinks?.open;
      if (!open || !deepLink.link) throw contractError('deepLinks.open', 'deeplink.open');
      this.lastDeepLink = title;
      await open.call(this.driver.deepLinks, deepLink.link);
    });
  }

  /**
   * Checks the capability, parses the canonical link and translates it with the driver. Runs
   * before the step starts so its title shows the translation; errors are returned and thrown
   * inside the step.
   */
  private planDeepLink(raw: unknown, capability: Capability, feature: string): DeepLinkPlan {
    const shown = typeof raw === 'string' ? raw : JSON.stringify(raw);
    try {
      this.requireCapability(capability, feature);
      const deepLinks = this.driver.deepLinks;
      if (!deepLinks) throw contractError('deepLinks', capability);
      const url = parseDeepLink(raw);
      let link: TranslatedDeepLink;
      try {
        link = deepLinks.translate(url);
      } catch (cause) {
        if (cause instanceof ToetsError) throw cause;
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new ToetsError(
          'DEEPLINK_INVALID',
          `The ${this.driver.platform} deepLink mapper threw for ${shown}: ${reason}`,
          {
            hint: `Fix the \`deepLink\` mapper in the ${this.driver.platform} app config of the toets config (a project's \`app\` overrides the top-level one). It receives the link as a URL.`,
            docs: DEEP_LINK_DOCS,
            cause,
          },
        );
      }
      const text = link.description === shown ? shown : `${shown} → ${link.description}`;
      return { text, link };
    } catch (error) {
      return { text: shown, error };
    }
  }

  private async connect(host: SdkHost, token: string, deepLink: boolean): Promise<SdkSession> {
    const timeoutMs = this.timeouts.sdkConnectMs;
    try {
      return await host.waitForSession(token, { timeoutMs });
    } catch (cause) {
      const fromLink = deepLink
        ? ' Launched from a deep link: whichever entry the link opens must start the SDK with the launch payload. On Android, trampoline activities (splash, router) must forward the intent extras (__toets) to the activity they start.'
        : '';
      throw new ToetsError(
        'SDK_NOT_CONNECTED',
        `The app did not connect to the toets SDK host at ${host.url} within ${timeoutMs}ms.`,
        {
          hint: `Check that the app includes the toets SDK and starts it at launch, that it reads the launch payload (__toets), and that the device can reach the host (drivers set up adb reverse on Android). For black-box runs, disable toets.sdk.${fromLink}`,
          docs: packageDocsLink('core', 'sdk'),
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
    const tree = await this.target.tree();
    return renderTextSnapshot(tree, undefined, { collapsed: this.textEntry.collapsed(tree) });
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

  /** Logs since the last call (driver, app via SDK, toets debug messages), oldest first. */
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
    this.lastLaunch = null;
    this.lastDeepLink = null;
    await this.takeLogs();
  }

  /** Collects a failure dump. Never throws. */
  async failureDump(): Promise<FailureDump> {
    const unavailable = (e: unknown) =>
      `unavailable: ${e instanceof Error ? e.message : String(e)}`;
    const session = this.target.sdk;
    const [focused, screen, screenshot, idle, keyboard] = await Promise.all([
      this.target.focused().then(describeElement, unavailable),
      this.snapshot().catch(unavailable),
      this.driver.screenshot().catch(() => null),
      this.target.waitForIdle(250).catch(() => ({ supported: false }) as const),
      this.textEntry.openKeyboard().then((k) => k ?? 'none', unavailable),
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
      keyboard,
      lastLaunch: this.lastLaunch,
      lastDeepLink: this.lastDeepLink,
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
  readonly keyboard: Keyboard;
  readonly textEntry: TextEntry;

  constructor(readonly runtime: AppRuntime) {
    const remote = new RemoteImpl(runtime);
    this.remote = remote;
    const focus = new FocusImpl(runtime, remote);
    this.focus = focus;
    this.textEntry = new TextEntry(runtime, remote, focus);
    this.keyboard = new KeyboardImpl(this.textEntry);
    this.media = new MediaImpl(runtime);
    this.network = new NetworkImpl(runtime);
    this.platform = new PlatformInfoImpl(runtime);
  }

  launch(opts?: LaunchOptions): Promise<void> {
    return this.runtime.launch(opts);
  }

  openDeepLink(url: string): Promise<void> {
    return this.runtime.openDeepLink(url);
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

/** The canonical link as a URL: `DEEPLINK_INVALID` unless it is an absolute URL string. */
function parseDeepLink(raw: unknown): URL {
  if (typeof raw === 'string') {
    try {
      return new URL(raw);
    } catch {
      // not absolute
    }
  }
  throw new ToetsError(
    'DEEPLINK_INVALID',
    `Deep link ${JSON.stringify(raw)} is not an absolute URL.`,
    {
      hint: "Use the app's own link for the content, with its scheme (`myapp://details/42`), the same on every platform. Translate it per platform with the `deepLink` mapper in the app config.",
      docs: DEEP_LINK_DOCS,
    },
  );
}

/** A driver that declares a deep link capability without implementing it. */
function contractError(member: string, capability: Capability): ToetsError {
  return new ToetsError(
    'DRIVER_CONTRACT',
    `The driver declares '${capability}' but has no \`${member}\`.`,
    {
      hint: 'A driver bug: implement the member or stop declaring the capability.',
      docs: packageDocsLink('core', 'drivers'),
    },
  );
}
