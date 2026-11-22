import type { Rule } from 'eslint';
import { ruleDocsUrl, staticName, unwrap } from '../utils.js';

/** Options of `@dpad-tv/no-sleep`. */
export interface NoSleepOptions {
  /** Function or method names treated as fixed waits. Default: {@link DEFAULT_SLEEP_FUNCTIONS}. */
  readonly functions?: readonly string[];
}

/** Fixed-wait helpers flagged by default. `delay` is left out: MSW uses it to simulate latency. */
export const DEFAULT_SLEEP_FUNCTIONS: readonly string[] = [
  'sleep',
  'wait',
  'pause',
  'waitForTimeout',
];

const TIMERS = new Set(['setTimeout', 'setInterval']);
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'global', 'self']);

export const noSleep: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow fixed waits (sleep helpers, raw timers) in tests and page objects.',
      recommended: true,
      url: ruleDocsUrl('no-sleep'),
    },
    schema: [
      {
        type: 'object',
        properties: {
          functions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      fixedWait:
        '`{{name}}` is a fixed wait: slow when the app is fast, flaky when it is slow. Wait for a state instead, e.g. `await expect(locator).toBeFocused()` (assertions retry until their timeout).',
      timer:
        'Raw `{{name}}` in a test is a fixed wait. Wait for a state instead, e.g. `await expect(locator).toBeVisible()`, or `app.focus.waitForChange(action)` for focus moves.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as NoSleepOptions;
    const functions = new Set(options.functions ?? DEFAULT_SLEEP_FUNCTIONS);

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const name = staticName(callee);
        if (!name) return;

        if (TIMERS.has(name)) {
          // `setTimeout(...)`, `globalThis.setTimeout(...)`; not `test.setTimeout(ms)` (Playwright).
          const isGlobal =
            callee.type === 'Identifier' ||
            (callee.type === 'MemberExpression' &&
              GLOBAL_OBJECTS.has(staticName(callee.object as never) ?? ''));
          if (isGlobal) context.report({ node, messageId: 'timer', data: { name } });
          return;
        }

        if (functions.has(name)) {
          context.report({ node, messageId: 'fixedWait', data: { name } });
        }
      },
    };
  },
};
