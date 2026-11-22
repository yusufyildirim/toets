import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DpadError,
  KEY_CAPABILITY,
  type Capability,
  type Driver,
  type DriverCreateContext,
  type DriverLaunchOptions,
  type ElementSnapshot,
  type Key,
  type LogEntry,
  type PressOptions,
  type Rect,
  type Selector,
  type SelectorChain,
  type UITree,
} from '@dpad-tv/core';
import { encodeLaunchPayloadParam } from '@dpad-tv/protocol';
import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type ConsoleMessage,
  type Disposable,
  type Frame,
  type Page,
} from 'playwright-core';
import {
  pageAgent,
  type AgentConfig,
  type AgentRequest,
  type AgentResponses,
  type AgentSelector,
} from './agent.js';
import { keyCapabilities, type WebKeySpec } from './keys.js';
import { launchUrl } from './launch.js';
import { LogBuffer, consoleLevel } from './logs.js';
import { resolveOptions, type ResolvedWebOptions, type WebDriverOptions } from './options.js';

/** Context for {@link createWebDriver}; the dpad runner passes a full `DriverCreateContext`. */
export type WebDriverContext = Partial<Pick<DriverCreateContext, 'app' | 'artifactsDir' | 'log'>>;

interface Session {
  readonly page: Page;
  readonly cdp: CDPSession;
  /** Removes the driver's page listeners. */
  readonly detach: () => void;
  /** Closes what the driver created (nothing for a borrowed page). */
  readonly close: () => Promise<void>;
}

/** Capabilities every web driver has, regardless of the key map. */
const BASE_CAPABILITIES: readonly Capability[] = [
  'key.longpress',
  'screenshot.element',
  'logs',
  'video',
];

/**
 * dpad driver for web apps in Chromium, built on Playwright. Thin by contract: reads report the
 * current DOM state immediately and input is real (trusted) browser input via the Chrome
 * DevTools Protocol. Waiting, retrying and matching live in the dpad core.
 */
export class WebDriver implements Driver {
  readonly platform = 'web' as const;
  readonly capabilities: ReadonlySet<Capability>;

  readonly #opts: ResolvedWebOptions;
  readonly #agentConfig: AgentConfig;
  readonly #artifactsDir: string;
  readonly #log: (message: string) => void;
  readonly #logs = new LogBuffer();
  readonly #origins = new Set<string>();
  #session: Session | null = null;
  #starting: Promise<void> | null = null;
  #initScript: Disposable | null = null;
  #recording: string | null = null;

  constructor(options: ResolvedWebOptions, ctx: WebDriverContext = {}) {
    this.#opts = options;
    this.#agentConfig = {
      testIdAttribute: options.testIdAttribute,
      focusedSelector: options.focusedSelector,
      focusableSelector: options.focusableSelector,
    };
    this.#artifactsDir = ctx.artifactsDir ?? join(tmpdir(), 'dpad-driver-web');
    this.#log = ctx.log ?? (() => {});
    this.capabilities = new Set([...keyCapabilities(options.keys), ...BASE_CAPABILITIES]);
  }

  /** Opens the browser page from the configured source. Idempotent. */
  async start(): Promise<void> {
    if (this.#session) return;
    this.#starting ??= this.#open().finally(() => (this.#starting = null));
    await this.#starting;
  }

  /** Closes what the driver opened; a borrowed page stays open. Safe to call twice. */
  async stop(): Promise<void> {
    await this.#starting?.catch(() => {});
    const session = this.#session;
    if (!session) return;
    this.#session = null;
    if (this.#recording !== null) {
      this.#recording = null;
      await session.page.screencast.stop().catch(() => {});
    }
    await this.#initScript?.dispose().catch(() => {});
    this.#initScript = null;
    session.detach();
    await session.cdp.detach().catch(() => {});
    await session.close().catch(() => {});
  }

  /**
   * Navigates to `about:blank` (terminate), optionally clears data, then loads the app URL with
   * the payload. Returns at the configured `waitUntil` milestone; app readiness is up to the
   * user's launch fixture.
   */
  async launch(opts: DriverLaunchOptions): Promise<void> {
    const { page } = this.#require();
    if (opts.clearData) await this.reset();
    else await this.terminate();

    await this.#initScript?.dispose();
    this.#initScript = null;
    let target = this.#opts.url.href;
    if (this.#opts.launchTransport === 'query') {
      target = launchUrl(this.#opts.url, opts.payload);
    } else {
      this.#initScript = await page.addInitScript(
        setLaunchGlobal,
        encodeLaunchPayloadParam(opts.payload),
      );
    }

    let response;
    try {
      response = await page.goto(target, { waitUntil: this.#opts.waitUntil });
    } catch (error) {
      throw new DpadError(
        'web.launch-failed',
        `Could not load the app at ${this.#opts.url.href}: ${firstLine(error)}`,
        {
          hint: 'Check that the app is served at the configured `url` (dev server running, right port) and loads without a network error.',
          docs: 'driver-web/setup',
          cause: error,
        },
      );
    }
    if (response && /^https?:$/.test(this.#opts.url.protocol) && !response.ok()) {
      throw new DpadError(
        'web.launch-failed',
        `The app URL ${this.#opts.url.href} answered HTTP ${response.status()}.`,
        {
          hint: 'Check the configured `url` path and that the server serves the app there.',
          docs: 'driver-web/setup',
        },
      );
    }
    this.#log(`web: launched ${this.#opts.url.href}`);
  }

  /** Unloads the app by navigating to `about:blank`. */
  async terminate(): Promise<void> {
    const { page } = this.#require();
    if (page.url() !== 'about:blank') await page.goto('about:blank');
  }

  /**
   * Terminates the app, then clears cookies and all storage (local/session storage, IndexedDB,
   * Cache Storage, service workers) of every origin the app's main frame visited. The HTTP cache
   * is kept: apps can not observe it and it keeps relaunches fast.
   */
  async reset(): Promise<void> {
    const { page, cdp } = this.#require();
    await this.terminate();
    await page.context().clearCookies();
    for (const origin of new Set([this.#opts.url.origin, ...this.#origins])) {
      if (!/^https?:\/\//.test(origin)) continue;
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    }
    this.#origins.clear();
  }

  async query(chain: SelectorChain): Promise<readonly ElementSnapshot[]> {
    const steps = chain.map(toAgentSelector);
    const result = await this.#evaluate({ op: 'query', config: this.#agentConfig, chain: steps });
    // Agent snapshots are ElementSnapshots with an unbranded `ref`; the brand is type-only.
    return result as unknown as readonly ElementSnapshot[];
  }

  async focused(): Promise<ElementSnapshot | null> {
    const result = await this.#evaluate({ op: 'focused', config: this.#agentConfig });
    return result as unknown as ElementSnapshot | null;
  }

  async tree(): Promise<UITree> {
    const result = await this.#evaluate({ op: 'tree', config: this.#agentConfig });
    if (result.root === null) {
      throw new DpadError('web.no-document', 'The page has no document element to read.', {
        hint: 'Launch the app before reading the UI.',
      });
    }
    return result as unknown as UITree;
  }

  /**
   * Presses a key as trusted keyboard input (CDP `Input.dispatchKeyEvent`). With `holdMs`, the
   * key auto-repeats (`KeyboardEvent.repeat`) after `keyRepeat.delayMs`, every
   * `keyRepeat.intervalMs`, until released.
   */
  async press(key: Key, opts?: PressOptions): Promise<void> {
    const spec = this.#opts.keys[key];
    if (spec === undefined) {
      const capability = KEY_CAPABILITY[key];
      throw new DpadError('web.key-unmapped', `Key ${key} has no web key mapping.`, {
        hint: `Map it in the web config, e.g. \`keys: { ${key}: { key: '...', keyCode: 0 } }\`.${
          capability ? ` Tests pressing it should declare \`requires: ['${capability}']\`.` : ''
        }`,
        docs: 'driver-web/keys',
      });
    }
    const { cdp } = this.#require();
    const holdMs = opts?.holdMs ?? 0;
    const down = keyDownEvent(spec);
    await cdp.send('Input.dispatchKeyEvent', down);
    try {
      if (holdMs > 0) {
        const { delayMs, intervalMs } = this.#opts.keyRepeat;
        const startedAt = performance.now();
        for (let at = delayMs; at < holdMs; at += intervalMs) {
          await sleepUntil(startedAt + at);
          await cdp.send('Input.dispatchKeyEvent', { ...down, autoRepeat: true });
        }
        await sleepUntil(startedAt + holdMs);
      }
    } finally {
      await cdp.send('Input.dispatchKeyEvent', keyUpEvent(spec));
    }
  }

  /**
   * PNG of the viewport, or of one element's visible part. The driver never scrolls to reach an
   * element (that would change app state); off-screen elements are an error.
   */
  async screenshot(opts?: { readonly element?: ElementSnapshot['ref'] }): Promise<Uint8Array> {
    const { page } = this.#require();
    if (opts?.element === undefined) return page.screenshot({ type: 'png' });
    const found = await this.#evaluate({ op: 'bounds', ref: opts.element });
    if (found === null) {
      throw new DpadError('web.stale-element', 'The element is no longer in the document.', {
        hint: 'Element refs are valid only while the element is attached. Locate it again.',
      });
    }
    const clip = intersect(found.bounds, { x: 0, y: 0, ...found.viewport });
    if (clip.width < 1 || clip.height < 1) {
      throw new DpadError('web.element-offscreen', 'The element is outside the viewport.', {
        hint: 'Bring it into view first, e.g. by navigating focus to it.',
      });
    }
    return page.screenshot({ type: 'png', clip });
  }

  async drainLogs(): Promise<readonly LogEntry[]> {
    return this.#logs.drain();
  }

  /** Starts recording the page (Playwright screencast, WebM) into the artifacts directory. */
  async startRecording(): Promise<void> {
    const { page } = this.#require();
    if (this.#recording !== null) {
      throw new DpadError('web.recording-active', 'A recording is already running.', {
        hint: 'Call stopRecording() before starting a new recording.',
      });
    }
    await mkdir(this.#artifactsDir, { recursive: true });
    const path = join(this.#artifactsDir, `web-${randomUUID()}.webm`);
    const size = page.viewportSize();
    await page.screencast.start(size ? { path, size } : { path });
    this.#recording = path;
  }

  /** Stops recording and returns the WebM file path. */
  async stopRecording(): Promise<string> {
    const { page } = this.#require();
    const path = this.#recording;
    if (path === null) {
      throw new DpadError('web.not-recording', 'No recording is running.', {
        hint: 'Call startRecording() first.',
      });
    }
    this.#recording = null;
    await page.screencast.stop();
    return path;
  }

  /** The Playwright `Page` the driver controls (for `app.platformOnly('web', page => ...)`). */
  escapeHatch(): Page {
    return this.#require().page;
  }

  async #open(): Promise<void> {
    const source = this.#opts.source;
    let page: Page;
    let close: () => Promise<void>;
    try {
      switch (source.kind) {
        case 'page':
          page = source.page;
          close = async () => {};
          break;
        case 'context':
          page = await source.context.newPage();
          close = () => page.close();
          break;
        case 'browser': {
          const context = await source.browser.newContext(source.contextOptions);
          close = () => context.close();
          page = await newPageOrClose(context, close);
          break;
        }
        case 'launch': {
          const browser = await chromium.launch(source.launchOptions);
          close = () => browser.close();
          const context = await browser
            .newContext(source.contextOptions)
            .catch(async (e: unknown) => {
              await close();
              throw e;
            });
          page = await newPageOrClose(context, close);
          break;
        }
      }
    } catch (error) {
      const missingBrowser = /Executable doesn't exist|playwright install/i.test(String(error));
      throw new DpadError(
        'web.start-failed',
        `Could not open a browser page: ${firstLine(error)}`,
        {
          hint: missingBrowser
            ? 'Install the browser: `npx playwright install chromium`.'
            : 'Check `launchOptions`/`contextOptions`, or the page/context/browser you passed.',
          docs: 'driver-web/setup',
          cause: error,
        },
      );
    }
    if (page.isClosed()) {
      throw new DpadError('web.page-closed', 'The page passed to the web driver is closed.', {
        hint: 'Pass an open page, or let the driver create one.',
        docs: 'driver-web/setup',
      });
    }

    let cdp: CDPSession;
    try {
      cdp = await page.context().newCDPSession(page);
    } catch (error) {
      await close().catch(() => {});
      throw new DpadError('web.not-chromium', 'The web driver needs a Chromium page.', {
        hint: 'Use Chromium (Playwright `chromium`, or `channel: "chrome"`); Firefox and WebKit are not supported.',
        docs: 'driver-web/setup',
        cause: error,
      });
    }

    const push = (level: LogEntry['level'], message: string, source: LogEntry['source']): void =>
      this.#logs.push({ level, message, timestamp: Date.now(), source });
    const onConsole = (msg: ConsoleMessage): void =>
      push(consoleLevel(msg.type()), msg.text(), 'app');
    const onPageError = (error: Error): void =>
      push('error', `Uncaught ${error.stack ?? `${error.name}: ${error.message}`}`, 'app');
    const onCrash = (): void => push('error', 'The page crashed.', 'driver');
    const onNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const origin = originOf(frame.url());
      if (origin !== null) this.#origins.add(origin);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('crash', onCrash);
    page.on('framenavigated', onNavigated);
    const detach = (): void => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('crash', onCrash);
      page.off('framenavigated', onNavigated);
    };
    this.#session = { page, cdp, detach, close };
  }

  #require(): Session {
    if (this.#session === null) {
      throw new DpadError('web.not-started', 'The web driver is not started.', {
        hint: 'Call `start()` first (the dpad runner does this once per worker).',
      });
    }
    return this.#session;
  }

  async #evaluate<R extends AgentRequest>(req: R): Promise<AgentResponses[R['op']]> {
    const { page } = this.#require();
    for (let attempt = 0; ; attempt++) {
      try {
        const json = await page.evaluate(pageAgent, req as AgentRequest);
        return JSON.parse(json) as AgentResponses[R['op']];
      } catch (error) {
        // The document was replaced mid-read: the new document is the current state, read it.
        if (attempt === 0 && isContextLost(error)) continue;
        throw this.#evaluateError(error, page);
      }
    }
  }

  #evaluateError(error: unknown, page: Page): DpadError {
    const message = firstLine(error);
    if (page.isClosed()) {
      return new DpadError('web.page-closed', 'The browser page was closed.', {
        hint: 'Something outside dpad closed the page or browser. Do not close it in a test.',
        cause: error,
      });
    }
    if (/is not a valid selector/.test(message)) {
      return new DpadError(
        'web.invalid-config',
        `A \`focus\` selector is not valid CSS: ${message}`,
        {
          hint: 'Fix `focus.focused` / `focus.focusable` in the web config.',
          docs: 'driver-web/options',
          cause: error,
        },
      );
    }
    return new DpadError('web.evaluate-failed', `Reading the page failed: ${message}`, {
      hint: 'The page may have navigated or crashed; check the app logs.',
      cause: error,
    });
  }
}

/**
 * Creates a web driver directly (scripts, tools, tests). The dpad runner uses the package's
 * default export instead. `options` win over `ctx.app`.
 */
export function createWebDriver(options: WebDriverOptions, ctx: WebDriverContext = {}): WebDriver {
  return new WebDriver(resolveOptions(options, ctx.app), ctx);
}

/** Runs in the page (init script transport): exposes the encoded payload to the top frame. */
function setLaunchGlobal(encoded: string): void {
  if (window.top === window) (window as unknown as { __DPAD__?: string }).__DPAD__ = encoded;
}

async function newPageOrClose(context: BrowserContext, close: () => Promise<void>): Promise<Page> {
  try {
    return await context.newPage();
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

function toAgentSelector(step: Selector): AgentSelector {
  if (step.kind !== 'text') return step;
  if (step.value instanceof RegExp) {
    return { kind: 'regex', source: step.value.source, flags: step.value.flags };
  }
  const value = step.value.replace(/\s+/g, ' ').trim();
  const exact = step.exact === true;
  return { kind: 'text', value: exact ? value : value.toLowerCase(), exact };
}

function keyDownEvent(spec: WebKeySpec) {
  return {
    // `keyDown` with text also produces `keypress`/activation (e.g. Enter on a button).
    type: spec.text === undefined ? ('rawKeyDown' as const) : ('keyDown' as const),
    key: spec.key,
    code: spec.code ?? '',
    windowsVirtualKeyCode: spec.keyCode ?? 0,
    ...(spec.text === undefined ? {} : { text: spec.text, unmodifiedText: spec.text }),
    autoRepeat: false,
  };
}

function keyUpEvent(spec: WebKeySpec) {
  return {
    type: 'keyUp' as const,
    key: spec.key,
    code: spec.code ?? '',
    windowsVirtualKeyCode: spec.keyCode ?? 0,
  };
}

async function sleepUntil(time: number): Promise<void> {
  const ms = time - performance.now();
  if (ms > 0) await sleep(ms);
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function isContextLost(error: unknown): boolean {
  return /Execution context was destroyed|Cannot find context with specified id/.test(
    firstLine(error),
  );
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}
