/**
 * The authoring API: what tests and page objects see. Implementations live in the core and
 * are platform independent; only {@link Driver}s differ per platform.
 *
 * Status: v1 contract draft. The `core`/`test` workstream owns refinements; other workstreams
 * code against these shapes.
 */
import type { MediaInfo } from '@toets/protocol';
import type { Capability } from './capabilities.js';
import type { Direction, DirectionKey, Key, PressOptions } from './keys.js';
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
  /**
   * Replaces the text of this field with `text`, the way a user would: focus moves to the field
   * with real D-pad presses, then the field's keyboard enters the text. Never submits;
   * `fill('')` clears the field. Waits until the field shows exactly `text`
   * (`TEXT_NOT_ENTERED` otherwise).
   *
   * The keyboard is, in order: a declared app keyboard ({@link KeyboardDefinition}) whose
   * `fields` lists this field, opened with SELECT when it is closed; system text entry when the
   * field is a system text field (`text.input`); otherwise `NO_KEYBOARD`. An app keyboard stays
   * open afterwards; a system keyboard that `fill` opened is closed again.
   *
   * @example
   * await app.getByTestId('search_query').fill('matrix');
   */
  fill(text: string, opts?: TextEntryOptions): Promise<void>;
}

/** Options of {@link Locator.fill} and {@link Keyboard.type}. */
export interface TextEntryOptions {
  /**
   * Shows the text as `••••` in step titles, reports and MCP output. Automatic for system
   * password fields; set it for PINs and passwords typed on app keyboards.
   */
  readonly mask?: boolean;
}

/**
 * The keyboard in use: the declared app keyboard holding focus, else system text entry on the
 * focused system text field, else the only declared keyboard on screen (`NO_KEYBOARD` or
 * `AMBIGUOUS_KEYBOARD` otherwise). Assert with `expect(app.keyboard).toBeOpen()`.
 */
export interface Keyboard {
  /**
   * Types `text` at the end of the field. On an app keyboard each character is a D-pad walk to
   * its key and SELECT, switching layers with the declared `layers` toggles when a key is not
   * shown; the field is checked afterwards when the keyboard declares `fields`.
   */
  type(text: string, opts?: TextEntryOptions): Promise<void>;
  /** Deletes `count` (default 1) characters before the caret: the backspace key. */
  erase(count?: number): Promise<void>;
  /** Presses the keyboard's submit key (system: the action key such as Search or Done). */
  submit(): Promise<void>;
}

/**
 * Points at an element: the same selectors as tests, `{ testId, text }` combined as
 * `getByTestId(testId).getByText(text)`.
 */
export interface ElementTarget {
  readonly testId?: string;
  /** Visible text: case-insensitive substring unless `exact`. */
  readonly text?: string;
  /** Full-text, case-sensitive match. */
  readonly exact?: boolean;
  /** 0-based pick among the matches. */
  readonly nth?: number;
}

/**
 * An app-drawn on-screen keyboard, declared once in config (`keyboards`) so `fill` and
 * `app.keyboard` can type on it with the D-pad. Create with `defineKeyboard()`.
 *
 * `root` and `fields` resolve from the screen root; the other targets resolve inside `root`.
 */
export interface KeyboardDefinition {
  /** Unique name, shown in step titles, snapshots and errors. */
  readonly name: string;
  /** The keyboard's container. The keyboard is open while it is visible. */
  readonly root: ElementTarget;
  /** Fields this keyboard types into: `fill` on them uses it, and `type` checks them. */
  readonly fields?: readonly ElementTarget[];
  /**
   * The character keys; every match counts, and a key types its text. Default: focusable
   * elements in `root` whose text is one character.
   */
  readonly keys?: readonly ElementTarget[];
  /** Keys that switch layers (Shift, `?123`), tried in order when a character is not shown. */
  readonly layers?: readonly ElementTarget[];
  /** The key that types a space (labels like `space` are not one character). */
  readonly space?: ElementTarget;
  /** The key that deletes one character: `erase`, and `fill` without `clear`. */
  readonly backspace?: ElementTarget;
  /** The key that empties the field, used by `fill`. */
  readonly clear?: ElementTarget;
  /** The key that submits: `app.keyboard.submit()`. */
  readonly submit?: ElementTarget;
}

/** PNG screenshot. Opaque; read the bytes with `screenshotPng()` from `@toets/core`. */
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

export interface PressUntilFocusedOptions {
  /** Give up after this many presses. Default 50. */
  readonly maxPresses?: number;
}

export interface Focus {
  /** Locator for the currently focused element. */
  current(): Locator;
  /**
   * Presses `key` until `target` (or an element inside it) is focused, reading focus after
   * every press. The recommended way to move focus: the app's focus engine decides every step,
   * toets only checks where focus landed. `target` may not exist yet (virtualized lists render
   * items as focus approaches). Fails fast when a press does not move focus (`FOCUS_STUCK`),
   * when focus comes back to an element it already left (`FOCUS_LOOP`) or after `maxPresses`
   * (`FOCUS_UNREACHABLE`).
   *
   * @returns The number of presses (0 when `target` already holds focus).
   * @example
   * await app.focus.pressUntilFocused(Key.RIGHT, app.getByTestId('rail-0-card-3'));
   */
  pressUntilFocused(
    key: DirectionKey,
    target: Locator,
    opts?: PressUntilFocusedOptions,
  ): Promise<number>;
  /**
   * Moves focus to `target` with real D-pad presses when the way there is not one direction.
   * Each press is aimed by element geometry and checked by reading focus, like
   * {@link Focus.pressUntilFocused}; presses that do not move focus are learned and detoured around.
   * `target` must be on screen. Throws `FOCUS_UNREACHABLE` when no option is left.
   *
   * @returns The directions pressed.
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
  /** Response status; `null` while in flight or when the request failed. */
  readonly status: number | null;
  /** Why the request failed (no route, upstream unreachable, handler threw), if it did. */
  readonly error?: { readonly code: string; readonly message: string } | null;
}

/** Network mocking and inspection (`network.mock`). Handlers come from `@toets/mock`. */
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
  /**
   * Launches the app from this deep link instead of its launcher entry (`deeplink.launch`): the
   * OS starts the app with the link, a cold start. One canonical, absolute URL for every
   * platform, the app's own link for the content (`myapp://details/42`); each platform's app
   * config may translate it (`deepLink` mapper). Combines with `state`, `flags` and `clearData`.
   *
   * @example
   * await app.launch({ deepLink: 'myapp://details/42' });
   */
  readonly deepLink?: string;
}

/** The app under test on the current target. The single fixture tests receive. */
export interface App {
  readonly platform: PlatformInfo;
  readonly remote: Remote;
  readonly focus: Focus;
  readonly media: Media;
  readonly network: Network;
  /** Text entry: the keyboard in use, app-drawn or system. */
  readonly keyboard: Keyboard;

  launch(opts?: LaunchOptions): Promise<void>;
  /**
   * Delivers a deep link to the running app, as the OS does when the user opens a link while
   * the app runs (`deeplink.open`). The app is not restarted: it receives the link (Android
   * `onNewIntent`, tvOS `application(_:open:)`, React Native `Linking` `url` events). `url` is
   * the same canonical link as in `launch({ deepLink })`, translated by the platform's
   * `deepLink` mapper. Needs a launched app.
   *
   * @example
   * await app.openDeepLink('myapp://details/42');
   */
  openDeepLink(url: string): Promise<void>;
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
