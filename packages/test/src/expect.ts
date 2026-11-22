import { existsSync, readFileSync } from 'node:fs';
import {
  expect as baseExpect,
  test as base,
  type ExpectMatcherState,
  type TestInfo,
} from '@playwright/test';
import type { MediaState } from '@dpad-tv/protocol';
import {
  appRuntime,
  packageDocsLink,
  DpadError,
  isLocator,
  locatorMatchers as lm,
  mediaMatchers as mm,
  networkMatchers as nm,
  normalizeTextSnapshot,
  screenshotPng,
  toMatchTextSnapshot as matchInline,
  type App,
  type Locator,
  type MatchContext,
  type MatchResult,
  type Media,
  type Network,
  type RequestFilter,
} from '@dpad-tv/core';

/** Every dpad matcher accepts a per-call timeout (ms); the default is `expect.timeout`. */
export interface TimeoutOption {
  readonly timeout?: number;
}

export interface TextSnapshotOptions extends TimeoutOption {
  /** Baseline file name, per project (platform). Default: derived from the test title. */
  readonly name?: string;
}

export interface ScreenshotAssertionOptions extends TimeoutOption {
  /** Baseline file name, per project (platform). Default: derived from the test title. */
  readonly name?: string;
  /** Regions painted over before comparing: video surfaces, clocks, spinners. */
  readonly mask?: readonly Locator[];
  /** Allowed number of differing pixels. */
  readonly maxDiffPixels?: number;
  /** Allowed ratio of differing pixels, 0 to 1. */
  readonly maxDiffPixelRatio?: number;
  /** Per-pixel color distance tolerance, 0 to 1. Default 0.2. */
  readonly threshold?: number;
}

const ctx = (state: ExpectMatcherState, opts?: TimeoutOption): MatchContext => ({
  isNot: state.isNot,
  timeoutMs: opts?.timeout ?? state.timeout,
});

const counters = new WeakMap<TestInfo, Map<string, number>>();

/** `<test title>-<n>.<ext>`, numbered per test and extension, like Playwright's own names. */
function defaultName(testInfo: TestInfo, ext: string): string {
  const perTest = counters.get(testInfo) ?? new Map<string, number>();
  counters.set(testInfo, perTest);
  const n = (perTest.get(ext) ?? 0) + 1;
  perTest.set(ext, n);
  const slug = testInfo.titlePath
    .slice(1)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return `${slug || 'snapshot'}-${n}.${ext}`;
}

function notSupported(name: string): DpadError {
  return new DpadError('NEGATION_UNSUPPORTED', `${name}() cannot be negated.`, {
    hint: 'Assert the expected state instead.',
    docs: packageDocsLink('core', 'assertions'),
  });
}

function assertSnapshotSubject(name: string, subject: unknown): asserts subject is App | Locator {
  if (!isLocator(subject) && !appRuntime(subject)) {
    throw new DpadError('INVALID_SUBJECT', `${name}() expects the app or a dpad Locator.`, {
      hint: `e.g. await expect(app).${name}() or await expect(app.getByTestId('rail')).${name}()`,
      docs: packageDocsLink('core', 'assertions'),
    });
  }
}

async function failFrom(name: string, run: () => void): Promise<MatchResult> {
  try {
    run();
    return { pass: true, name, message: () => `${name} passed` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { pass: false, name, message: () => message };
  }
}

/**
 * Text snapshot assertion. With a string, compares inline (indentation ignored). Without one,
 * compares to a per-platform baseline file, written on first run or with `--update-snapshots`.
 */
async function toMatchTextSnapshot(
  this: ExpectMatcherState,
  subject: App | Locator,
  expected?: string | TextSnapshotOptions,
  opts?: TimeoutOption,
): Promise<MatchResult> {
  assertSnapshotSubject('toMatchTextSnapshot', subject);
  if (typeof expected === 'string') return matchInline(ctx(this, opts), subject, expected);
  if (this.isNot) throw notSupported('toMatchTextSnapshot');
  const testInfo = base.info();
  const name = expected?.name ?? defaultName(testInfo, 'yml');
  const path = testInfo.snapshotPath(name);
  let actual: string;
  if (existsSync(path)) {
    const result = await matchInline(ctx(this, expected), subject, readFileSync(path, 'utf8'));
    if (result.pass) return result;
    actual = typeof result.actual === 'string' ? result.actual : await subject.snapshot();
  } else {
    actual = normalizeTextSnapshot(await subject.snapshot());
  }
  // Playwright owns writing, updating and attaching baselines.
  return failFrom('toMatchTextSnapshot', () => baseExpect(`${actual}\n`).toMatchSnapshot(name));
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Screenshot assertion against a per-platform baseline. Waits for two identical consecutive
 * screenshots (after masking) before comparing with Playwright's image comparator.
 */
async function toMatchScreenshot(
  this: ExpectMatcherState,
  subject: App | Locator,
  opts: ScreenshotAssertionOptions = {},
): Promise<MatchResult> {
  assertSnapshotSubject('toMatchScreenshot', subject);
  if (this.isNot) throw notSupported('toMatchScreenshot');
  const timeout = opts.timeout ?? this.timeout;
  const shoot = async () =>
    screenshotPng(await subject.screenshot(opts.mask ? { mask: opts.mask } : undefined));
  const deadline = performance.now() + timeout;
  let previous = await shoot();
  let current = previous;
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    current = await shoot();
    if (sameBytes(previous, current)) break;
    if (performance.now() > deadline) {
      return {
        pass: false,
        name: 'toMatchScreenshot',
        message: () =>
          `expect(${isLocator(subject) ? 'locator' : 'app'}).toMatchScreenshot() failed\n\nThe screen kept changing for ${timeout}ms, so no stable screenshot could be taken.\nHint: mask moving regions (video, clocks, spinners) with { mask: [locator] }.`,
      };
    }
    previous = current;
  }
  const testInfo = base.info();
  const name = opts.name ?? defaultName(testInfo, 'png');
  const compare = {
    name,
    ...(opts.maxDiffPixels === undefined ? {} : { maxDiffPixels: opts.maxDiffPixels }),
    ...(opts.maxDiffPixelRatio === undefined ? {} : { maxDiffPixelRatio: opts.maxDiffPixelRatio }),
    ...(opts.threshold === undefined ? {} : { threshold: opts.threshold }),
  };
  return failFrom('toMatchScreenshot', () =>
    baseExpect(Buffer.from(current)).toMatchSnapshot(compare),
  );
}

/** The dpad matchers, typed per subject: locators, `app`, `app.media`, `app.network`. */
export const dpadMatchers = {
  toBeVisible(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeVisible(ctx(this, opts), locator);
  },
  toBeInViewport(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeInViewport(ctx(this, opts), locator);
  },
  toBeFocused(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeFocused(ctx(this, opts), locator);
  },
  toHaveFocusWithin(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toHaveFocusWithin(ctx(this, opts), locator);
  },
  toBeEnabled(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeEnabled(ctx(this, opts), locator);
  },
  toBeDisabled(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeDisabled(ctx(this, opts), locator);
  },
  toBeSelected(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeSelected(ctx(this, opts), locator);
  },
  toBeBusy(this: ExpectMatcherState, locator: Locator, opts?: TimeoutOption) {
    return lm.toBeBusy(ctx(this, opts), locator);
  },
  toHaveText(
    this: ExpectMatcherState,
    locator: Locator,
    expected: string | RegExp,
    opts?: TimeoutOption,
  ) {
    return lm.toHaveText(ctx(this, opts), locator, expected);
  },
  toContainText(
    this: ExpectMatcherState,
    locator: Locator,
    expected: string | RegExp,
    opts?: TimeoutOption,
  ) {
    return lm.toContainText(ctx(this, opts), locator, expected);
  },
  toHaveCount(this: ExpectMatcherState, locator: Locator, count: number, opts?: TimeoutOption) {
    return lm.toHaveCount(ctx(this, opts), locator, count);
  },
  toMatchTextSnapshot,
  toMatchScreenshot,
  toBePlaying(this: ExpectMatcherState, media: Media, opts?: TimeoutOption) {
    return mm.toBePlaying(ctx(this, opts), media);
  },
  toBePaused(this: ExpectMatcherState, media: Media, opts?: TimeoutOption) {
    return mm.toBePaused(ctx(this, opts), media);
  },
  toHaveMediaState(
    this: ExpectMatcherState,
    media: Media,
    state: MediaState,
    opts?: TimeoutOption,
  ) {
    return mm.toHaveMediaState(ctx(this, opts), media, state);
  },
  /** Position within `tolerance` seconds (default 1) of `seconds`. */
  toHavePosition(
    this: ExpectMatcherState,
    media: Media,
    seconds: number,
    opts?: TimeoutOption & { tolerance?: number },
  ) {
    return mm.toHavePosition(ctx(this, opts), media, seconds, opts);
  },
  /** At least one recorded request matching `filter`, or exactly `times`. */
  toHaveRequested(
    this: ExpectMatcherState,
    network: Network,
    filter: RequestFilter,
    opts?: TimeoutOption & { times?: number },
  ) {
    return nm.toHaveRequested(ctx(this, opts), network, filter, opts);
  },
};

/**
 * Playwright's `expect` with the dpad matchers. Every dpad matcher retries until it passes or
 * `expect.timeout` elapses, waiting for app idle first when the SDK provides it.
 */
export const expect = baseExpect.extend(dpadMatchers);
