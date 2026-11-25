import type { LaunchPayload } from '@toets/protocol';
import type { PlatformEvent } from './api.js';
import type { Capability } from './capabilities.js';
import type { DeviceLease, DeviceProvider } from './devices.js';
import type { Key, PressOptions } from './keys.js';
import type { Platform } from './platform.js';
import type { SelectorChain } from './selectors.js';
import type { ElementRef, ElementSnapshot, LogEntry, UITree } from './snapshot.js';

export interface DriverLaunchOptions {
  /** Encoded by the driver using the platform's transport (see `@toets/protocol` launch). */
  readonly payload: LaunchPayload;
  /** Clear app data before launching. */
  readonly clearData?: boolean;
}

/**
 * The contract every platform driver implements. Drivers are deliberately thin: they report
 * raw state and perform raw input. Waiting, retrying, matching, key overrides, capability
 * checks and reporting all live in the core so behavior is identical on every platform.
 *
 * Rules for implementers:
 * - Never wait or retry inside `query`/`focused`/`tree`: return the current state immediately.
 * - `ElementSnapshot.ref` must identify the same element across `query`, `focused` and `tree`
 *   and stay stable while the element is attached: the core compares refs to detect focus
 *   movement and to find a located element in the tree.
 * - `press` sends real platform input (no synthetic in-app events).
 * - Throw `ToetsError` with a precise `hint` for anything the user can fix.
 */
export interface Driver {
  readonly platform: Platform;
  /** Static capabilities of this driver on this target (SDK capabilities are added by the core). */
  readonly capabilities: ReadonlySet<Capability>;

  /** Opens the automation session (browser page, Appium session). Called once per worker. */
  start(): Promise<void>;
  /** Closes the session and frees resources. Must be safe to call twice. */
  stop(): Promise<void>;

  /** Terminates the app if running, then launches it with the payload. Returns once launched. */
  launch(opts: DriverLaunchOptions): Promise<void>;
  terminate(): Promise<void>;
  /** Restores a clean app state (clear data / storage). */
  reset(): Promise<void>;

  /** All elements matching the chain, in document/tree order. Empty when none. */
  query(chain: SelectorChain): Promise<readonly ElementSnapshot[]>;
  /** The element holding focus, or `null`. */
  focused(): Promise<ElementSnapshot | null>;
  /** The whole UI tree (used for text snapshots, failure dumps, focus geometry). */
  tree(): Promise<UITree>;

  /** Presses a key. Only called for keys whose capability the driver declares. */
  press(key: Key, opts?: PressOptions): Promise<void>;
  /** PNG bytes of the viewport or one element (`screenshot.element`). */
  screenshot(opts?: { readonly element?: ElementRef }): Promise<Uint8Array>;

  /** Returns and clears logs collected since the last call. */
  drainLogs(): Promise<readonly LogEntry[]>;

  /** Emits an OS-level lifecycle or environment event (`platform.events`). */
  emit?(event: PlatformEvent): Promise<void>;

  /** Starts screen recording (`video`). */
  startRecording?(): Promise<void>;
  /** Stops recording and returns the file path of the video. */
  stopRecording?(): Promise<string>;

  /**
   * System text entry (`text.input`). Present exactly when the driver declares `text.input`.
   */
  readonly text?: DriverTextInput;

  /** The underlying tool handle for `app.platformOnly` (Playwright `Page`, WebdriverIO `Browser`). */
  escapeHatch(): unknown;
}

/**
 * System text entry: how the platform puts text into an editable field, the way its own
 * keyboards (on-screen, IME, remote apps) do. The core reaches fields with real D-pad presses
 * first, then calls these; it verifies the result and closes a keyboard `replace` left open.
 * Text never goes through synthetic in-app events (VISION decision 17).
 */
export interface DriverTextInput {
  /**
   * Whether system text entry is active now: a system keyboard is on screen, or (web, where TV
   * keyboards have no DOM) an editable element holds focus.
   */
  isOpen(): Promise<boolean>;
  /**
   * Replaces the whole text of `field`, the focused editable element, with `text` (`''`
   * clears it). Never submits. May open the system keyboard.
   */
  replace(field: ElementSnapshot, text: string): Promise<void>;
  /** Inserts `text` at the caret of active text entry. May open the system keyboard. */
  insert(text: string): Promise<void>;
  /** Deletes `count` characters before the caret of active text entry. */
  deleteBackward(count: number): Promise<void>;
  /** Triggers the keyboard's action key (Search, Done, Go) of active text entry. */
  submit(): Promise<void>;
  /** Closes the system keyboard if one is on screen, keeping the text. */
  close(): Promise<void>;
}

/** Per-platform app config from the user's toets config. */
export interface AppTargetConfig {
  readonly [key: string]: unknown;
}

export interface DriverCreateContext {
  readonly app: AppTargetConfig;
  /** Directory relative paths in `app` (APKs, app bundles) resolve against. Default: the cwd. */
  readonly configDir?: string;
  /** Present for device-backed platforms. */
  readonly device?: DeviceLease;
  readonly workerIndex: number;
  /** Directory for this worker's artifacts (videos, logs). */
  readonly artifactsDir: string;
  readonly log: (message: string) => void;
}

/**
 * What a driver package exports as `default`. `@toets/test` loads driver packages lazily so
 * users install only the platforms they target.
 */
export interface DriverModule<Options = Record<string, unknown>> {
  readonly platform: Platform;
  createDriver(options: Options, ctx: DriverCreateContext): Promise<Driver>;
  /** Device-backed platforms provide a provider for the `managed` device mode. */
  createDeviceProvider?(options: Options): DeviceProvider;
}
