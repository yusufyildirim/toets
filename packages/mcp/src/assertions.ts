/**
 * The `assert` tool: toets's matchers, run through the very functions `expect` uses
 * (`locatorMatchers`, `toMatchTextSnapshot`, `mediaMatchers`, `networkMatchers` from the core),
 * so an assertion passes or fails here exactly as it would in a test.
 */
import {
  ToetsError,
  keyboardMatchers,
  locatorMatchers,
  mediaMatchers,
  networkMatchers,
  normalizeTextSnapshot,
  packageDocsLink,
  toMatchTextSnapshot,
  type AppRuntime,
  type MatchContext,
  type MatchResult,
  type RequestFilter,
} from '@toets/core';
import { jsString } from '@toets/core/runner';
import { MEDIA_STATES, type MediaState } from '@toets/protocol';
import { locate, locatorCode, type Target } from './locate.js';

const STATE_MATCHERS = [
  'toBeVisible',
  'toBeInViewport',
  'toBeFocused',
  'toHaveFocusWithin',
  'toBeEnabled',
  'toBeDisabled',
  'toBeSelected',
  'toBeBusy',
] as const;
const TEXT_MATCHERS = ['toHaveText', 'toContainText', 'toHaveValue'] as const;
const MEDIA_MATCHERS = ['toBePlaying', 'toBePaused', 'toHaveMediaState', 'toHavePosition'] as const;

/** Every matcher `assert` offers: all toets matchers except the screenshot baseline one. */
export const MATCHERS = [
  ...STATE_MATCHERS,
  ...TEXT_MATCHERS,
  'toHaveCount',
  'toMatchTextSnapshot',
  'toBeOpen',
  ...MEDIA_MATCHERS,
  'toHaveRequested',
] as const;
export type MatcherName = (typeof MATCHERS)[number];

export interface Assertion {
  readonly matcher: MatcherName;
  readonly target?: Target | undefined;
  /**
   * Text (`toHaveText`, `toContainText`), value (`toHaveValue`), YAML (`toMatchTextSnapshot`) or
   * a media state.
   */
  readonly expected?: string | undefined;
  readonly count?: number | undefined;
  readonly seconds?: number | undefined;
  readonly tolerance?: number | undefined;
  readonly request?:
    { readonly method?: string | undefined; readonly url?: string | undefined } | undefined;
  readonly times?: number | undefined;
  readonly not?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface AssertOutcome {
  readonly pass: boolean;
  /** The assertion as test code. */
  readonly code: string;
  /** The matcher's message: on failure, exactly what `expect` reports in a test. */
  readonly message: string;
  readonly elapsedMs: number;
}

type Field = 'target' | 'expected' | 'count' | 'seconds' | 'tolerance' | 'request' | 'times';

const isIn = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** Input fields each matcher takes (`target` is required where listed, except snapshots). */
function fieldsOf(matcher: MatcherName): {
  readonly required: Field[];
  readonly optional: Field[];
} {
  if (isIn(STATE_MATCHERS, matcher)) return { required: ['target'], optional: [] };
  if (isIn(TEXT_MATCHERS, matcher)) return { required: ['target', 'expected'], optional: [] };
  switch (matcher) {
    case 'toHaveCount':
      return { required: ['target', 'count'], optional: [] };
    case 'toMatchTextSnapshot':
      return { required: ['expected'], optional: ['target'] };
    case 'toHaveMediaState':
      return { required: ['expected'], optional: [] };
    case 'toHavePosition':
      return { required: ['seconds'], optional: ['tolerance'] };
    case 'toHaveRequested':
      return { required: [], optional: ['request', 'times'] };
    default:
      return { required: [], optional: [] };
  }
}

function badInput(message: string, hint: string): ToetsError {
  return new ToetsError('MCP_BAD_INPUT', message, { hint, docs: packageDocsLink('mcp', 'tools') });
}

function validate(a: Assertion): void {
  const { required, optional } = fieldsOf(a.matcher);
  for (const field of required) {
    if (a[field] === undefined) {
      throw badInput(
        `${a.matcher} needs \`${field}\`.`,
        `Pass ${required.map((f) => `\`${f}\``).join(' and ')}; see the \`assert\` input schema.`,
      );
    }
  }
  const allowed = new Set<Field>([...required, ...optional]);
  const extra = (
    ['target', 'expected', 'count', 'seconds', 'tolerance', 'request', 'times'] as const
  ).filter((f) => a[f] !== undefined && !allowed.has(f));
  if (extra.length) {
    throw badInput(
      `${a.matcher} does not take ${extra.map((f) => `\`${f}\``).join(', ')}.`,
      allowed.size
        ? `It takes ${[...allowed].map((f) => `\`${f}\``).join(', ')}.`
        : 'It takes no arguments besides `not` and `timeoutMs`.',
    );
  }
  if (a.matcher === 'toHaveMediaState' && !isIn(MEDIA_STATES, a.expected ?? '')) {
    throw badInput(
      `Unknown media state ${JSON.stringify(a.expected)}.`,
      `Use one of: ${MEDIA_STATES.join(', ')}.`,
    );
  }
}

/** A template literal holding a text snapshot, indented like a test would write it. */
function snapshotLiteral(yaml: string): string {
  const body = normalizeTextSnapshot(yaml)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
  return `\`\n${body}\n\``;
}

function objectLiteral(entries: readonly [string, string | number | undefined][]): string | null {
  const parts = entries.flatMap(([k, v]) =>
    v === undefined ? [] : [`${k}: ${typeof v === 'string' ? jsString(v) : v}`],
  );
  return parts.length ? `{ ${parts.join(', ')} }` : null;
}

function filterOf(a: Assertion): RequestFilter {
  return {
    ...(a.request?.method === undefined ? {} : { method: a.request.method }),
    ...(a.request?.url === undefined ? {} : { url: a.request.url }),
  };
}

/** The test code for an assertion, e.g. `await expect(app.getByTestId('x')).not.toBeFocused();`. */
function assertionCode(a: Assertion, subject: string): string {
  const timeout: [string, number | undefined] = ['timeout', a.timeoutMs];
  const args: string[] = [];
  const push = (arg: string | null) => arg !== null && args.push(arg);
  if (isIn(TEXT_MATCHERS, a.matcher) || a.matcher === 'toHaveMediaState') {
    push(jsString(a.expected ?? ''));
    push(objectLiteral([timeout]));
  } else if (a.matcher === 'toHaveCount') {
    push(String(a.count));
    push(objectLiteral([timeout]));
  } else if (a.matcher === 'toMatchTextSnapshot') {
    push(snapshotLiteral(a.expected ?? ''));
    push(objectLiteral([timeout]));
  } else if (a.matcher === 'toHavePosition') {
    push(String(a.seconds));
    push(objectLiteral([['tolerance', a.tolerance], timeout]));
  } else if (a.matcher === 'toHaveRequested') {
    const filter = filterOf(a);
    push(
      objectLiteral([
        ['method', filter.method],
        ['url', filter.url as string | undefined],
      ]) ?? '{}',
    );
    push(objectLiteral([['times', a.times], timeout]));
  } else {
    push(objectLiteral([timeout]));
  }
  return `await expect(${subject})${a.not ? '.not' : ''}.${a.matcher}(${args.join(', ')});`;
}

/**
 * Runs one assertion with the core matchers, retrying (with idle sync when the SDK has it)
 * until it holds or the timeout passes.
 */
export async function runAssertion(
  runtime: AppRuntime,
  a: Assertion,
  defaultTimeoutMs: number,
): Promise<AssertOutcome> {
  validate(a);
  const app = runtime.app;
  const ctx: MatchContext = { isNot: a.not === true, timeoutMs: a.timeoutMs ?? defaultTimeoutMs };
  const locator = a.target ? locate(app, a.target) : null;
  const subject = locator
    ? locatorCode(locator)
    : isIn(MEDIA_MATCHERS, a.matcher)
      ? 'app.media'
      : a.matcher === 'toHaveRequested'
        ? 'app.network'
        : a.matcher === 'toBeOpen'
          ? 'app.keyboard'
          : 'app';
  const code = assertionCode(a, subject);

  const run = (): Promise<MatchResult> => {
    const m = a.matcher;
    if (isIn(STATE_MATCHERS, m)) return locatorMatchers[m](ctx, locator!);
    if (isIn(TEXT_MATCHERS, m)) return locatorMatchers[m](ctx, locator!, a.expected ?? '');
    switch (m) {
      case 'toHaveCount':
        return locatorMatchers.toHaveCount(ctx, locator!, a.count ?? 0);
      case 'toMatchTextSnapshot':
        return toMatchTextSnapshot(ctx, locator ?? app, a.expected ?? '');
      case 'toBeOpen':
        return keyboardMatchers.toBeOpen(ctx, app.keyboard);
      case 'toBePlaying':
        return mediaMatchers.toBePlaying(ctx, app.media);
      case 'toBePaused':
        return mediaMatchers.toBePaused(ctx, app.media);
      case 'toHaveMediaState':
        return mediaMatchers.toHaveMediaState(ctx, app.media, a.expected as MediaState);
      case 'toHavePosition':
        return mediaMatchers.toHavePosition(
          ctx,
          app.media,
          a.seconds ?? 0,
          a.tolerance === undefined ? undefined : { tolerance: a.tolerance },
        );
      case 'toHaveRequested':
        return networkMatchers.toHaveRequested(
          ctx,
          app.network,
          filterOf(a),
          a.times === undefined ? undefined : { times: a.times },
        );
    }
  };

  const start = performance.now();
  const result = await run();
  return {
    // Playwright's matcher contract: `pass` is whether the positive form held.
    pass: result.pass !== ctx.isNot,
    code,
    message: result.message(),
    elapsedMs: Math.round(performance.now() - start),
  };
}
