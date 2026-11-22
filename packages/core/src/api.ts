/**
 * The authoring API: what tests and page objects see. Implementations live in the core and
 * are platform independent; only {@link Driver}s differ per platform.
 *
 * Status: v1 contract draft. The `core`/`test` workstream owns refinements; other workstreams
 * code against these shapes.
 */
import type { MediaInfo } from '@dpad-tv/protocol';
import type { Capability } from './capabilities.js';
import type { Direction, Key, PressOptions } from './keys.js';
import type { Platform } from './platform.js';

/** Reference to UI element(s). Lazy: resolved on every use, so it never goes stale. Opaque. */
export interface Locator {
  readonly __locator: unique symbol;
  getByTestId(testId: string): Locator;
  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator;
  first(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  /** Current text. Prefer `expect(locator).toHaveText()` for assertions. */
  text(): Promise<string | null>;
  testId(): Promise<string | null>;
  /** Current visibility. Prefer `expect(locator).toBeVisible()` for assertions. */
  isVisible(): Promise<boolean>;
  isFocused(): Promise<boolean>;
  /** PNG of this element, cropped from the viewport. Waits for exactly one match. */
  screenshot(opts?: ScreenshotOptions): Promise<Screenshot>;
  /** Text snapshot (YAML) of this element's subtree. */
  snapshot(): Promise<string>;
}

/** PNG screenshot. Opaque; read the bytes with `screenshotPng()` from `@dpad-tv/core`. */
export interface Screenshot {
  readonly __screenshot: unique symbol;
}

export interface ScreenshotOptions {
  /**
   * Elements painted over with a solid color before the image is returned, for regions that
   * never settle (video surfaces, clocks, spinners).
   */
  readonly mask?: readonly Locator[];
}

export interface Remote {
  press(key: Key, opts?: PressOptions): Promise<void>;
  longPress(key: Key, holdMs?: number): Promise<void>;
  /** Presses `key` `times` times. */
  repeat(key: Key, times: number, opts?: { intervalMs?: number }): Promise<void>;
  sequence(keys: readonly Key[], opts?: { intervalMs?: number }): Promise<void>;
}

export interface NavigateOptions {
  /** Give up after this many presses. Default 50. */
  readonly maxPresses?: number;
}

export interface Focus {
  /** Locator for the currently focused element. */
  current(): Locator;
  /**
   * Moves focus to `target` with real D-pad presses, choosing directions from the SDK focus
   * graph when available, otherwise from element geometry. The path taken is reported.
   * Throws when the target is unreachable.
   */
  navigateTo(target: Locator, opts?: NavigateOptions): Promise<readonly Direction[]>;
  /** Runs `action` and waits until focus moves to a different element. */
  waitForChange(action: () => Promise<void>, opts?: { timeoutMs?: number }): Promise<void>;
}

/** Media playback state (`media.state`). Assert with `expect(app.media).toBePlaying()` etc. */
export interface Media {
  get(): Promise<MediaInfo | null>;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly timestamp: number;
  /** Whether a mock handler answered (vs proxied upstream). */
  readonly mocked: boolean;
  readonly status: number | null;
}

/** Network mocking and inspection (`network.mock`). Handlers come from `@dpad-tv/mock`. */
export interface Network {
  /** Adds handlers for the current test; most recently added wins. Reset after each test. */
  use(...handlers: readonly unknown[]): void;
  resetHandlers(): void;
  requests(filter?: {
    method?: string;
    url?: string | RegExp;
  }): Promise<readonly RecordedRequest[]>;
}

export type PlatformEvent = 'suspend' | 'resume' | 'network-lost' | 'network-restored';

export interface PlatformInfo {
  readonly name: Platform;
  readonly capabilities: ReadonlySet<Capability>;
  has(capability: Capability): boolean;
  /** Emits an OS-level event (`platform.events`). */
  emit(event: PlatformEvent): Promise<void>;
}

export interface LaunchOptions {
  /** Named app state to launch into (`app.state`). */
  readonly state?: string;
  readonly flags?: Readonly<Record<string, string | number | boolean>>;
  /** Clear app data before launching. Default false. */
  readonly clearData?: boolean;
}

/** The app under test on the current target. The single fixture tests receive. */
export interface App {
  readonly platform: PlatformInfo;
  readonly remote: Remote;
  readonly focus: Focus;
  readonly media: Media;
  readonly network: Network;

  launch(opts?: LaunchOptions): Promise<void>;
  terminate(): Promise<void>;
  reset(): Promise<void>;

  getByTestId(testId: string): Locator;
  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator;

  screenshot(opts?: ScreenshotOptions): Promise<Screenshot>;
  /** Text snapshot (YAML) of the whole screen, focus-aware. */
  snapshot(): Promise<string>;

  /**
   * Escape hatch to the underlying tool on one platform; a no-op elsewhere. Visible in reports
   * and discouraged by the ESLint plugin. Prefer adding a capability instead.
   */
  platformOnly(platform: Platform, fn: (handle: unknown) => Promise<void>): Promise<void>;
}
