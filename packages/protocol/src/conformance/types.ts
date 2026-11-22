import type { LaunchPayload } from '../launch.js';
import type { HelloParams } from '../messages.js';

/** What the suite hands to {@link ConformanceTarget.launch}. */
export interface ConformanceLaunch {
  readonly payload: LaunchPayload;
  /** Base64url form of the payload, ready for URLs, intent extras and launch arguments. */
  readonly encoded: string;
}

/**
 * The SDK implementation under test, seen from the host. The suite only talks over the
 * wire, so any SDK (JS or not) can be tested: `launch` starts the app (or a test program
 * embedding the SDK) with the given payload, `terminate` stops it.
 */
export interface ConformanceTarget {
  /** Shown in the report, e.g. `@dpad-tv/sdk/web in Chromium`. */
  readonly name?: string;
  launch(launch: ConformanceLaunch): Promise<void> | void;
  terminate(): Promise<void> | void;
  /**
   * The app implements the conformance fixture (screen and `onState` handler, see
   * `docs/conformance.md`). Enables the behavioral checks (focus events, logs, busy, state).
   */
  readonly fixture?: boolean;
}

export interface ConformanceOptions {
  /** Time the app has to connect after each launch. Default 15000. */
  readonly connectTimeoutMs?: number;
  /** Per-request timeout. Default 5000. */
  readonly requestTimeoutMs?: number;
  /** Run only checks whose id equals or starts with one of these. */
  readonly only?: readonly string[];
  /** Called as each check finishes (progress output). */
  readonly onResult?: (result: CheckResult) => void;
}

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  /** Stable id, e.g. `tree.shape`. */
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  /** Why it failed or was skipped. */
  readonly message?: string;
  readonly durationMs: number;
}

export interface ConformanceReport {
  readonly target: string;
  /** No check failed. */
  readonly passed: boolean;
  readonly results: readonly CheckResult[];
  /** The handshake the SDK sent in the main session, when it connected. */
  readonly hello?: HelloParams;
}

/** Contract of the conformance fixture app. See `docs/conformance.md`. */
export const CONFORMANCE_FIXTURE = {
  testIds: {
    /** Focusable, visible element. */
    a: 'conformance-a',
    /** Second focusable, visible element. */
    b: 'conformance-b',
    /** Non-focusable element whose own text is {@link CONFORMANCE_FIXTURE.text}. */
    text: 'conformance-text',
  },
  text: 'Conformance',
  /** States the fixture's `onState` handler implements. */
  states: {
    /** Move focus to `conformance-a`. */
    focusA: 'conformance:focus-a',
    /** Move focus to `conformance-b`. */
    focusB: 'conformance:focus-b',
    /** Log `flags.marker` through the platform's normal console (level info). */
    log: 'conformance:log',
    /** Mark the app busy (kind `custom`) for `flags.ms` milliseconds. */
    busy: 'conformance:busy',
    /** Throw from the handler. */
    fail: 'conformance:fail',
  },
} as const;
