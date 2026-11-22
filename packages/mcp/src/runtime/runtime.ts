/**
 * The seam between MCP tools and dpad. Tools only talk to {@link ScreenRuntime}; today it is
 * implemented directly over the `Driver` contract with small local helpers.
 *
 * TODO(core): implement `ScreenRuntime` over the core `App` (locators, remote
 * with key overrides and capability checks, `focus.navigateTo`, matchers, text snapshot, SDK
 * composition) and delete the local helpers in this folder. Tool code should not need changes.
 */
import {
  DIRECTION_KEY,
  DpadError,
  KEY_CAPABILITY,
  docsLink,
  type Capability,
  type Direction,
  type Driver,
  type ElementSnapshot,
  type Key,
  type LaunchOptions,
  type Platform,
} from '@dpad-tv/core';
import { evaluate, type Assertion } from './matchers.js';
import { navigateTo, type NavigateResult } from './navigate.js';
import { targetToChain, targetToCode, type Target } from './target.js';
import { findNode, renderTextSnapshot } from './text-snapshot.js';
import { delay, poll, POLL_INTERVAL_MS } from './wait.js';

export interface AssertResult {
  readonly pass: boolean;
  readonly received: string;
  readonly elapsedMs: number;
}

/** What the MCP tools need from dpad, phrased in test vocabulary. */
export interface ScreenRuntime {
  readonly platform: Platform;
  readonly capabilities: ReadonlySet<Capability>;
  launch(opts: LaunchOptions): Promise<void>;
  /** Presses keys in order (capability-checked), then waits for focus to settle. */
  press(keys: readonly Key[], opts?: { readonly holdMs?: number }): Promise<void>;
  focused(): Promise<ElementSnapshot | null>;
  /** Current matches of `target`, without waiting. */
  query(target: Target): Promise<readonly ElementSnapshot[]>;
  /** Text snapshot of the screen or of one element's subtree. */
  snapshot(target?: Target): Promise<string>;
  screenshot(target?: Target): Promise<Uint8Array>;
  /** Retries `assertion` until it passes or `timeoutMs` elapses. */
  assert(target: Target, assertion: Assertion, timeoutMs: number): Promise<AssertResult>;
  navigateTo(target: Target, opts: { readonly maxPresses: number }): Promise<NavigateResult>;
}

/** How long focus may keep changing after a press before we report it. */
const SETTLE_TIMEOUT_MS = 1000;

/** {@link ScreenRuntime} directly over a {@link Driver} (black-box, no SDK). */
export class DriverRuntime implements ScreenRuntime {
  constructor(private readonly driver: Driver) {}

  get platform(): Platform {
    return this.driver.platform;
  }

  get capabilities(): ReadonlySet<Capability> {
    return this.driver.capabilities;
  }

  async launch(opts: LaunchOptions): Promise<void> {
    if ((opts.state !== undefined || opts.flags !== undefined) && !this.has('app.state')) {
      throw new DpadError(
        'CAPABILITY_MISSING',
        `Launching into a named state or with flags needs the \`app.state\` capability, which ${this.platform} does not have here.`,
        {
          hint: 'Launch without `state`/`flags` and reach the screen with `navigate_to` / `press`, or integrate the dpad SDK in the app.',
          docs: docsLink('concepts/capabilities'),
        },
      );
    }
    await this.driver.launch({
      payload: {
        v: 1,
        ...(opts.state !== undefined && { state: opts.state }),
        ...(opts.flags !== undefined && { flags: opts.flags }),
      },
      ...(opts.clearData !== undefined && { clearData: opts.clearData }),
    });
  }

  async press(keys: readonly Key[], opts: { readonly holdMs?: number } = {}): Promise<void> {
    for (const key of keys) this.checkKey(key, opts.holdMs);
    for (const key of keys) {
      await this.driver.press(key, opts.holdMs === undefined ? undefined : { holdMs: opts.holdMs });
    }
    await this.settle();
  }

  focused(): Promise<ElementSnapshot | null> {
    return this.driver.focused();
  }

  query(target: Target): Promise<readonly ElementSnapshot[]> {
    return this.driver.query(targetToChain(target));
  }

  async snapshot(target?: Target): Promise<string> {
    const tree = await this.driver.tree();
    if (!target) return renderTextSnapshot(tree.root);
    const el = await this.resolveOne(target);
    const node = findNode(tree.root, el.ref);
    if (!node) throw notFound(target, 'it disappeared while taking the snapshot');
    return renderTextSnapshot(node);
  }

  async screenshot(target?: Target): Promise<Uint8Array> {
    if (!target) return this.driver.screenshot();
    if (!this.has('screenshot.element')) {
      throw new DpadError(
        'CAPABILITY_MISSING',
        `Element screenshots need the \`screenshot.element\` capability, which ${this.platform} does not have.`,
        {
          hint: 'Take a full screenshot (omit `target`).',
          docs: docsLink('concepts/capabilities'),
        },
      );
    }
    const el = await this.resolveOne(target);
    return this.driver.screenshot({ element: el.ref });
  }

  async assert(target: Target, assertion: Assertion, timeoutMs: number): Promise<AssertResult> {
    const result = await poll(async () => {
      const matches = await this.query(target);
      if (matches.length > 1) throw strictViolation(target, matches.length);
      const el = matches[0] ?? null;
      const focused = assertion.matcher === 'toBeFocused' ? await this.driver.focused() : null;
      const outcome = evaluate(assertion, el, focused);
      return { done: outcome.pass, value: outcome.received };
    }, timeoutMs);
    return { pass: result.done, received: result.value, elapsedMs: result.elapsedMs };
  }

  navigateTo(target: Target, opts: { readonly maxPresses: number }): Promise<NavigateResult> {
    return navigateTo(
      {
        resolve: () => this.resolveOne(target),
        focused: () => this.driver.focused(),
        move: async (direction: Direction) => {
          const before = await this.driver.focused();
          await this.driver.press(DIRECTION_KEY[direction]);
          // Wait for focus to leave `before`; a blocked direction just times out.
          const { value } = await poll(async () => {
            const now = await this.driver.focused();
            return { done: now?.ref !== before?.ref, value: now };
          }, SETTLE_TIMEOUT_MS / 2);
          return value;
        },
      },
      opts.maxPresses,
    );
  }

  private has(capability: Capability): boolean {
    return this.driver.capabilities.has(capability);
  }

  private checkKey(key: Key, holdMs: number | undefined): void {
    const needed = KEY_CAPABILITY[key];
    if (needed && !this.has(needed)) {
      throw new DpadError(
        'KEY_UNSUPPORTED',
        `${key} needs the \`${needed}\` capability, which ${this.platform} does not have.`,
        {
          hint: `Use \`capabilities\` to list the keys this target supports. In tests, gate on it with \`requires('${needed}')\`.`,
          docs: docsLink('concepts/remote-and-keys'),
        },
      );
    }
    if (holdMs !== undefined && !this.has('key.longpress')) {
      throw new DpadError(
        'KEY_UNSUPPORTED',
        `Long presses need the \`key.longpress\` capability, which ${this.platform} does not have.`,
        { hint: 'Omit `holdMs`.', docs: docsLink('concepts/remote-and-keys') },
      );
    }
  }

  /** Waits until two consecutive focus reads agree (or the settle timeout passes). */
  private async settle(): Promise<void> {
    let last = (await this.driver.focused())?.ref;
    await poll(async () => {
      await delay(POLL_INTERVAL_MS);
      const now = (await this.driver.focused())?.ref;
      const stable = now === last;
      last = now;
      return { done: stable, value: undefined };
    }, SETTLE_TIMEOUT_MS);
  }

  private async resolveOne(target: Target): Promise<ElementSnapshot> {
    const matches = await this.query(target);
    if (matches.length > 1) throw strictViolation(target, matches.length);
    const el = matches[0];
    if (!el) throw notFound(target);
    return el;
  }
}

function notFound(target: Target, why?: string): DpadError {
  return new DpadError(
    'ELEMENT_NOT_FOUND',
    `No element matches ${targetToCode(target)}${why ? `: ${why}` : ''}.`,
    {
      hint: 'Check the current screen with `snapshot`. Lists on TV are often virtualized: elements far offscreen do not exist yet, so move focus toward them first.',
      docs: docsLink('concepts/locators-and-assertions'),
    },
  );
}

function strictViolation(target: Target, count: number): DpadError {
  return new DpadError(
    'STRICT_MODE_VIOLATION',
    `${targetToCode(target)} matches ${count} elements; a locator must match exactly one.`,
    {
      hint: 'Use a test ID, add `exact: true`, or pick one with `nth`. `query` lists the matches.',
      docs: docsLink('concepts/locators-and-assertions'),
    },
  );
}
