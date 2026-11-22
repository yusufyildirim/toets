/**
 * The matcher subset the MCP `assert` tool offers.
 *
 * TODO(core): replace `evaluate` with the core matchers (implemented once over
 * `ElementSnapshot`) so `assert` passes or fails exactly like `expect(...)` in a test.
 */
import type { ElementSnapshot } from '@dpad-tv/core';
import { describeElement } from './text-snapshot.js';

export const MATCHERS = ['toBeVisible', 'toBeFocused', 'toHaveText', 'toContainText'] as const;
export type MatcherName = (typeof MATCHERS)[number];

export interface Assertion {
  readonly matcher: MatcherName;
  /** Expected text for `toHaveText` / `toContainText`. */
  readonly expected?: string | undefined;
  readonly not?: boolean | undefined;
}

export interface MatchOutcome {
  readonly pass: boolean;
  /** What was observed, phrased for a failure message. */
  readonly received: string;
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Evaluates one assertion against the current match (`null` = nothing matched). */
export function evaluate(
  assertion: Assertion,
  el: ElementSnapshot | null,
  focused: ElementSnapshot | null,
): MatchOutcome {
  const raw = ((): MatchOutcome => {
    if (!el) return { pass: false, received: 'no element matches' };
    switch (assertion.matcher) {
      case 'toBeVisible':
        return { pass: el.visible, received: el.visible ? 'visible' : 'hidden' };
      case 'toBeFocused':
        return {
          pass: el.focused,
          received: el.focused
            ? 'focused'
            : `not focused; focus is on ${focused ? describeElement(focused) : 'nothing'}`,
        };
      case 'toHaveText':
      case 'toContainText': {
        const actual = normalize(el.text ?? '');
        const expected = normalize(assertion.expected ?? '');
        const pass =
          assertion.matcher === 'toHaveText' ? actual === expected : actual.includes(expected);
        return { pass, received: `text ${JSON.stringify(actual)}` };
      }
    }
  })();
  return assertion.not ? { pass: !raw.pass, received: raw.received } : raw;
}

/** The assertion as test code, e.g. `await expect(app.getByTestId('x')).not.toBeFocused();`. */
export function assertionToCode(assertion: Assertion, locatorCode: string): string {
  const arg =
    assertion.matcher === 'toHaveText' || assertion.matcher === 'toContainText'
      ? `'${(assertion.expected ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : '';
  return `await expect(${locatorCode})${assertion.not ? '.not' : ''}.${assertion.matcher}(${arg});`;
}
