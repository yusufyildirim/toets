import type { SdkHost } from '@toets/protocol';
import type { KeyboardDefinition } from '../api.js';
import type { Driver } from '../driver.js';
import type { Key, KeyOverride } from '../keys.js';
import type { MockServerLike } from '../mock.js';

/** App-level key overrides for one platform (VISION decision 17). Flagged in reports. */
export type KeyOverrides = Readonly<Partial<Record<Key, KeyOverride>>>;

/** What kind of user-visible action a step is. */
export type ActionKind =
  | 'launch'
  | 'openDeepLink'
  | 'terminate'
  | 'reset'
  | 'press'
  | 'repeat'
  | 'sequence'
  | 'navigate'
  | 'pressUntilFocused'
  | 'waitForFocusChange'
  | 'emit'
  | 'platformOnly'
  | 'fill'
  | 'type'
  | 'erase'
  | 'submit'
  | 'key';

export interface ActionInfo {
  readonly kind: ActionKind;
  /** Human readable, deterministic, e.g. `press RIGHT` or `navigateTo getByTestId('like')`. */
  readonly title: string;
  /** Set when a key override changed how a key is performed. */
  readonly override?: { readonly key: Key; readonly performedAs: string };
  /**
   * What the action did, known once it finished (`9 presses`). Runners show it next to the
   * title (Playwright step annotation); titles are fixed when a step starts.
   */
  readonly summary?: () => string;
}

/**
 * Integration point for runners. `@toets/test` turns every action into a Playwright
 * `test.step` and attaches per-step artifacts; the default just runs the action.
 */
export interface ActionHooks {
  step<T>(info: ActionInfo, run: () => Promise<T>): Promise<T>;
}

export const DIRECT_HOOKS: ActionHooks = { step: (_info, run) => run() };

export interface Timeouts {
  /** Assertions (`expect`). Default 5000. Playwright's `expect.timeout` overrides it there. */
  readonly expectMs: number;
  /** Waits inside actions and reads (element presence, focus change). Default 5000. */
  readonly actionMs: number;
  /** How long `launch()` waits for the SDK handshake. Default 15000. */
  readonly sdkConnectMs: number;
  /**
   * How long `pressUntilFocused` and `navigateTo` wait for focus to move after a press. Default 1000.
   * `pressUntilFocused` reports a press that did not move focus in this time as stuck.
   */
  readonly navigationSettleMs: number;
}

export interface IdleOptions {
  /** Quiet period the SDK must see before it reports idle. Default 100. */
  readonly quietMs: number;
  /** Max wait for idle before an assertion falls back to polling. Default 2000. */
  readonly budgetMs: number;
}

export interface RemoteOptions {
  /** Pause between presses in `repeat` and `sequence`. Default 100. */
  readonly intervalMs: number;
  /** Hold time of `longPress` without an explicit duration. Default 1000. */
  readonly longPressMs: number;
}

export interface AppRuntimeOptions {
  readonly driver: Driver;
  /** Enables the in-app SDK: each launch issues a token and waits for the app to connect. */
  readonly sdkHost?: SdkHost | undefined;
  /** Enables network mocking: the launch payload points the app at this server. */
  readonly mock?: MockServerLike | undefined;
  readonly keyOverrides?: KeyOverrides | undefined;
  readonly timeouts?: Partial<Timeouts> | undefined;
  readonly idle?: Partial<IdleOptions> | undefined;
  readonly remote?: Partial<RemoteOptions> | undefined;
  readonly hooks?: ActionHooks | undefined;
  /** Declared app keyboards (`defineKeyboard`). */
  readonly keyboards?: readonly KeyboardDefinition[] | undefined;
  /** Debug log sink. Messages are also kept for failure dumps. */
  readonly log?: ((message: string) => void) | undefined;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  expectMs: 5000,
  actionMs: 5000,
  sdkConnectMs: 15000,
  navigationSettleMs: 1000,
};

export const DEFAULT_IDLE: IdleOptions = { quietMs: 100, budgetMs: 2000 };

export const DEFAULT_REMOTE: RemoteOptions = { intervalMs: 100, longPressMs: 1000 };
