import type { PlatformEvent, ScreenshotOptions } from '../api.js';
import type { Capability } from '../capabilities.js';
import type { Key } from '../keys.js';
import type { MockServerLike } from '../mock.js';
import type {
  ActionHooks,
  ActionInfo,
  IdleOptions,
  KeyOverrides,
  RemoteOptions,
  Timeouts,
} from './options.js';
import type { RetryResult } from './retry.js';
import type { Target } from './target.js';

/** One remote key press, as recorded for failure dumps. */
export interface KeyLogEntry {
  readonly key: Key;
  /** How it was performed when an override applied, e.g. `hold RIGHT 800ms`. */
  readonly performedAs?: string;
  readonly holdMs?: number;
  readonly at: number;
}

export interface CapturedScreen {
  readonly png: Uint8Array;
  readonly viewportWidth: number;
}

/** Internal services shared by the authoring API objects of one app. */
export interface RuntimeContext {
  readonly target: Target;
  readonly mock: MockServerLike | undefined;
  readonly timeouts: Timeouts;
  readonly idle: IdleOptions;
  readonly remote: RemoteOptions;
  readonly keyOverrides: KeyOverrides;
  readonly hooks: ActionHooks;
  step<T>(info: ActionInfo, run: () => Promise<T>): Promise<T>;
  retry<T>(
    evaluate: () => Promise<{ readonly ok: boolean; readonly value: T }>,
    timeoutMs: number,
  ): Promise<RetryResult<T>>;
  /** Throws a `DpadError` naming `feature` when the capability is missing. */
  requireCapability(capability: Capability, feature: string): void;
  recordKey(entry: KeyLogEntry): void;
  /** Records an emitted platform event, so state like a lost network is restored between tests. */
  recordEvent(event: PlatformEvent): void;
  captureScreen(opts?: ScreenshotOptions): Promise<CapturedScreen>;
  log(message: string): void;
}
