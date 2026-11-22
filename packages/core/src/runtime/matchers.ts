/**
 * Every dpad assertion, implemented once over platform-neutral state. Runners adapt these to
 * their `expect` (`@dpad-tv/test` wires them into Playwright's `expect.extend`); the MCP server
 * calls them directly. Results follow Playwright's custom matcher contract: `pass` is whether
 * the positive condition held, and the runner inverts it for `.not`.
 */
import type { MediaInfo, MediaState } from '@dpad-tv/protocol';
import type { App, Locator, Media, Network, RecordedRequest } from '../api.js';
import { DpadError, docsLink } from '../errors.js';
import type { RequestFilter } from '../mock.js';
import type { ElementSnapshot } from '../snapshot.js';
import { appRuntime } from './app.js';
import type { RuntimeContext } from './context.js';
import { lineDiff } from './diff.js';
import { MediaImpl, NetworkImpl } from './domains.js';
import { describeElement, locatorImpl, strictModeError, type LocatorImpl } from './locator.js';
import { describeIdle } from './retry.js';
import { normalizeTextSnapshot } from './text-snapshot.js';
import { normalizeText, testRegExp } from './tree.js';

export interface MatchContext {
  /** Called with `.not`. */
  readonly isNot: boolean;
  /** Overrides the runtime's `expectMs`. */
  readonly timeoutMs?: number | undefined;
}

export interface MatchResult {
  readonly pass: boolean;
  readonly message: () => string;
  readonly name: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly timeout?: number;
}

interface Evaluation {
  /** Whether the positive condition holds; `null` when it cannot be judged (element missing). */
  readonly pass: boolean | null;
  readonly received: string;
  readonly actual?: unknown;
}

interface MatcherSpec {
  readonly name: string;
  readonly runtime: RuntimeContext;
  /** `locator`, `app`, `app.media`, `app.network`. */
  readonly subject: string;
  readonly args?: string;
  /** Extra header lines, e.g. `Locator: getByTestId('x')`. */
  readonly header: readonly string[];
  /** What the positive form expects, e.g. `focused`. */
  readonly expected: string;
  readonly evaluate: () => Promise<Evaluation>;
  /** Context lines computed once after a failure. */
  readonly explain?: (last: Evaluation | undefined) => Promise<readonly string[]>;
  /** Replaces the Expected/Received block (used for diffs). */
  readonly body?: (last: Evaluation | undefined, isNot: boolean) => readonly string[] | null;
}

const pad = (label: string) => `${label}:`.padEnd(10);

async function runMatcher(ctx: MatchContext, spec: MatcherSpec): Promise<MatchResult> {
  const timeoutMs = ctx.timeoutMs ?? spec.runtime.timeouts.expectMs;
  const result = await spec.runtime.retry(async () => {
    const value = await spec.evaluate();
    return { ok: value.pass !== null && value.pass !== ctx.isNot, value };
  }, timeoutMs);
  const last = result.value;
  if (result.ok) {
    return {
      pass: !ctx.isNot,
      name: spec.name,
      expected: spec.expected,
      actual: last?.actual,
      message: () =>
        `expect(${spec.subject}).${ctx.isNot ? '' : 'not.'}${spec.name}(${spec.args ?? ''}) passed`,
    };
  }
  const extra = spec.explain ? await spec.explain(last).catch(() => []) : [];
  const lines = [
    `expect(${spec.subject}).${ctx.isNot ? 'not.' : ''}${spec.name}(${spec.args ?? ''}) failed`,
    '',
    ...spec.header,
  ];
  const body = spec.body?.(last, ctx.isNot);
  if (body) {
    lines.push(...body);
  } else {
    lines.push(`${pad('Expected')}${ctx.isNot ? 'not ' : ''}${spec.expected}`);
    lines.push(`${pad('Received')}${last?.received ?? 'nothing (every check threw)'}`);
  }
  lines.push(`${pad('Timeout')}${timeoutMs}ms`, `${pad('Idle')}${describeIdle(result.idle)}`);
  lines.push(...extra);
  lines.push(
    '',
    'Call log:',
    `  - ${result.attempts} checks over ${Math.round(result.elapsedMs)}ms`,
  );
  if (result.error) lines.push(`  - last check threw: ${String(result.error)}`);
  const message = lines.join('\n');
  return {
    // Fail in both forms: positive did not hold, or negative kept holding.
    pass: ctx.isNot,
    name: spec.name,
    expected: spec.expected,
    actual: last?.actual,
    timeout: timeoutMs,
    message: () => message,
  };
}

function invalidSubject(name: string, wanted: string, got: unknown): DpadError {
  const kind = got === null ? 'null' : typeof got === 'object' ? 'a non-dpad object' : typeof got;
  return new DpadError('INVALID_SUBJECT', `${name}() expects ${wanted}, got ${kind}.`, {
    hint: `Assert on ${wanted}, e.g. expect(app.getByTestId('id')).${name}().`,
    docs: docsLink('core/assertions'),
  });
}

function asLocator(name: string, subject: unknown): LocatorImpl {
  const impl = locatorImpl(subject);
  if (!impl) throw invalidSubject(name, 'a dpad Locator', subject);
  return impl;
}

/** The single match of a locator, `null` when missing; throws on several (strict). */
async function single(locator: LocatorImpl): Promise<ElementSnapshot | null> {
  const matches = await locator.resolve();
  if (matches.length > 1) throw strictModeError(locator.chain, matches);
  return matches[0] ?? null;
}

interface StateMatcher {
  readonly name: string;
  readonly expected: string;
  readonly negated: string;
  readonly test: (el: ElementSnapshot) => boolean;
  /** `false`: a missing element simply lacks the state. `wait`: a missing element fails both forms. */
  readonly missing: 'false' | 'wait';
  readonly focusContext?: boolean;
}

function stateMatcher(def: StateMatcher) {
  return async (ctx: MatchContext, subject: Locator): Promise<MatchResult> => {
    const locator = asLocator(def.name, subject);
    return runMatcher(ctx, {
      name: def.name,
      runtime: locator.ctx,
      subject: 'locator',
      header: [`${pad('Locator')}${locator.description}`],
      expected: def.expected,
      evaluate: async () => {
        const el = await single(locator);
        if (!el) {
          return { pass: def.missing === 'false' ? false : null, received: 'element not found' };
        }
        const pass = def.test(el);
        return { pass, received: pass ? def.expected : def.negated, actual: el };
      },
      explain: async () => {
        if (!def.focusContext) return [];
        const focused = await locator.ctx.target.focused();
        return [`${pad('Focused')}${describeElement(focused)}`];
      },
    });
  };
}

const displayValue = (v: string | RegExp): string =>
  v instanceof RegExp ? String(v) : JSON.stringify(v);

function textMatcher(name: 'toHaveText' | 'toContainText') {
  return async (
    ctx: MatchContext,
    subject: Locator,
    expected: string | RegExp,
  ): Promise<MatchResult> => {
    const locator = asLocator(name, subject);
    if (typeof expected !== 'string' && !(expected instanceof RegExp)) {
      throw new DpadError('INVALID_ARGUMENT', `${name}() expects a string or RegExp.`, {
        docs: docsLink('core/assertions'),
      });
    }
    const wanted = expected instanceof RegExp ? expected : (normalizeText(expected) ?? '');
    return runMatcher(ctx, {
      name,
      runtime: locator.ctx,
      subject: 'locator',
      args: displayValue(expected),
      header: [`${pad('Locator')}${locator.description}`],
      expected: `${name === 'toHaveText' ? 'text' : 'text containing'} ${displayValue(expected)}`,
      evaluate: async () => {
        const el = await single(locator);
        if (!el) return { pass: null, received: 'element not found' };
        const text = normalizeText(el.text) ?? '';
        let pass: boolean;
        if (wanted instanceof RegExp) {
          pass = testRegExp(wanted, text);
        } else {
          pass = name === 'toHaveText' ? text === wanted : text.includes(wanted);
        }
        return { pass, received: `text ${JSON.stringify(text)}`, actual: text };
      },
    });
  };
}

/** Assertions on a {@link Locator}. */
export const locatorMatchers = {
  toBeVisible: stateMatcher({
    name: 'toBeVisible',
    expected: 'visible',
    negated: 'hidden',
    test: (el) => el.visible,
    missing: 'false',
  }),
  toBeInViewport: stateMatcher({
    name: 'toBeInViewport',
    expected: 'in viewport',
    negated: 'outside the viewport',
    test: (el) => el.inViewport,
    missing: 'false',
  }),
  toBeFocused: stateMatcher({
    name: 'toBeFocused',
    expected: 'focused',
    negated: 'not focused',
    test: (el) => el.focused,
    missing: 'wait',
    focusContext: true,
  }),
  toHaveFocusWithin: stateMatcher({
    name: 'toHaveFocusWithin',
    expected: 'focus within',
    negated: 'no focus within',
    test: (el) => el.focusWithin,
    missing: 'wait',
    focusContext: true,
  }),
  toBeEnabled: stateMatcher({
    name: 'toBeEnabled',
    expected: 'enabled',
    negated: 'disabled',
    test: (el) => el.enabled,
    missing: 'wait',
  }),
  toBeDisabled: stateMatcher({
    name: 'toBeDisabled',
    expected: 'disabled',
    negated: 'enabled',
    test: (el) => !el.enabled,
    missing: 'wait',
  }),
  toBeSelected: stateMatcher({
    name: 'toBeSelected',
    expected: 'selected',
    negated: 'not selected',
    test: (el) => el.selected,
    missing: 'wait',
  }),
  toBeBusy: stateMatcher({
    name: 'toBeBusy',
    expected: 'busy',
    negated: 'not busy',
    test: (el) => el.busy,
    missing: 'wait',
  }),
  toHaveText: textMatcher('toHaveText'),
  toContainText: textMatcher('toContainText'),
  async toHaveCount(ctx: MatchContext, subject: Locator, count: number): Promise<MatchResult> {
    const locator = asLocator('toHaveCount', subject);
    if (!Number.isInteger(count) || count < 0) {
      throw new DpadError(
        'INVALID_ARGUMENT',
        `toHaveCount() needs a non-negative integer, got ${count}.`,
        {
          docs: docsLink('core/assertions'),
        },
      );
    }
    return runMatcher(ctx, {
      name: 'toHaveCount',
      runtime: locator.ctx,
      subject: 'locator',
      args: String(count),
      header: [`${pad('Locator')}${locator.description}`],
      expected: `${count} element(s)`,
      evaluate: async () => {
        const n = (await locator.resolve()).length;
        return { pass: n === count, received: `${n} element(s)`, actual: n };
      },
    });
  },
};

function snapshotSubject(subject: unknown): {
  runtime: RuntimeContext;
  label: string;
  header: string[];
  take: () => Promise<string | null>;
} {
  const locator = locatorImpl(subject);
  if (locator) {
    return {
      runtime: locator.ctx,
      label: 'locator',
      header: [`${pad('Locator')}${locator.description}`],
      take: async () => ((await single(locator)) ? await locator.snapshot() : null),
    };
  }
  const runtime = appRuntime(subject);
  if (runtime) return { runtime, label: 'app', header: [], take: () => runtime.snapshot() };
  throw invalidSubject('toMatchTextSnapshot', 'the app or a dpad Locator', subject);
}

/**
 * Asserts a text snapshot equals `expected` (inline YAML; indentation and surrounding blank
 * lines are ignored). Retries until it matches or the timeout passes.
 */
export async function toMatchTextSnapshot(
  ctx: MatchContext,
  subject: App | Locator,
  expected: string,
): Promise<MatchResult> {
  const s = snapshotSubject(subject);
  const wanted = normalizeTextSnapshot(expected);
  return runMatcher(ctx, {
    name: 'toMatchTextSnapshot',
    runtime: s.runtime,
    subject: s.label,
    header: s.header,
    expected: wanted,
    evaluate: async () => {
      const snap = await s.take();
      if (snap === null) return { pass: null, received: 'element not found' };
      const actual = normalizeTextSnapshot(snap);
      return { pass: actual === wanted, received: actual, actual };
    },
    body: (last, isNot) => {
      if (!last || last.actual === undefined) return null;
      if (isNot)
        return ['Expected the snapshot to differ, but it matched:', String(last.actual), ''];
      return ['Diff (- expected, + received):', lineDiff(wanted, String(last.actual)), ''];
    },
  });
}

function asMedia(name: string, subject: unknown): RuntimeContext {
  if (!(subject instanceof MediaImpl)) throw invalidSubject(name, 'app.media', subject);
  return subject.ctx;
}

const describeMedia = (m: MediaInfo | null): string =>
  m
    ? `${m.state} at ${m.position.toFixed(1)}s${m.duration === null ? '' : ` / ${m.duration.toFixed(1)}s`}${m.error ? ` (error: ${m.error})` : ''}`
    : 'no active media';

async function mediaMatcher(
  name: string,
  subject: unknown,
  ctx: MatchContext,
  expected: string,
  test: (m: MediaInfo) => boolean,
  args?: string,
): Promise<MatchResult> {
  const runtime = asMedia(name, subject);
  runtime.requireCapability('media.state', `expect(app.media).${name}()`);
  return runMatcher(ctx, {
    name,
    runtime,
    subject: 'app.media',
    ...(args === undefined ? {} : { args }),
    header: [],
    expected,
    evaluate: async () => {
      const media = (await runtime.target.media()) ?? null;
      return { pass: media ? test(media) : false, received: describeMedia(media), actual: media };
    },
  });
}

/** Assertions on `app.media` (`media.state`). */
export const mediaMatchers = {
  toBePlaying: (ctx: MatchContext, media: Media) =>
    mediaMatcher('toBePlaying', media, ctx, 'playing', (m) => m.state === 'playing'),
  toBePaused: (ctx: MatchContext, media: Media) =>
    mediaMatcher('toBePaused', media, ctx, 'paused', (m) => m.state === 'paused'),
  toHaveMediaState: (ctx: MatchContext, media: Media, state: MediaState) =>
    mediaMatcher(
      'toHaveMediaState',
      media,
      ctx,
      state,
      (m) => m.state === state,
      JSON.stringify(state),
    ),
  /** Position within `tolerance` seconds (default 1) of `seconds`. */
  toHavePosition: (
    ctx: MatchContext,
    media: Media,
    seconds: number,
    opts?: { tolerance?: number },
  ) => {
    const tolerance = opts?.tolerance ?? 1;
    return mediaMatcher(
      'toHavePosition',
      media,
      ctx,
      `position ${seconds}s (+/- ${tolerance}s)`,
      (m) => Math.abs(m.position - seconds) <= tolerance,
      String(seconds),
    );
  },
};

const describeFilter = (f: RequestFilter): string =>
  [f.method, f.url === undefined ? undefined : String(f.url)].filter(Boolean).join(' ') ||
  'any request';

const describeRequest = (r: RecordedRequest): string =>
  `${r.method} ${r.url} -> ${r.status ?? 'pending'}${r.mocked ? ' (mocked)' : ''}`;

/** Assertions on `app.network` (`network.mock`). */
export const networkMatchers = {
  /** At least one matching request, or exactly `times` when given. */
  async toHaveRequested(
    ctx: MatchContext,
    network: Network,
    filter: RequestFilter,
    opts?: { times?: number },
  ): Promise<MatchResult> {
    if (!(network instanceof NetworkImpl))
      throw invalidSubject('toHaveRequested', 'app.network', network);
    const server = network.server();
    const times = opts?.times;
    return runMatcher(ctx, {
      name: 'toHaveRequested',
      runtime: network.ctx,
      subject: 'app.network',
      args: JSON.stringify({
        ...filter,
        url: filter.url === undefined ? undefined : String(filter.url),
      }),
      header: [],
      expected: `${times === undefined ? 'at least one' : `exactly ${times}`} request(s) matching ${describeFilter(filter)}`,
      evaluate: async () => {
        const n = server.requests(filter).length;
        return {
          pass: times === undefined ? n > 0 : n === times,
          received: `${n} matching request(s)`,
          actual: n,
        };
      },
      explain: async () => {
        const recent = server.requests().slice(-10);
        return recent.length
          ? ['Recent requests:', ...recent.map((r) => `  - ${describeRequest(r)}`)]
          : ['Recent requests: none recorded'];
      },
    });
  },
};
