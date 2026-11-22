import type { SelectorChain } from '@dpad-tv/core';

/**
 * What an MCP tool points at: the same selectors a test uses (decision 6: test ID + text).
 * `testId` and `text` combine as `app.getByTestId(id).getByText(text)`.
 */
export interface Target {
  readonly testId?: string | undefined;
  readonly text?: string | undefined;
  /** Exact, case-sensitive full-text match. Default: case-insensitive substring. */
  readonly exact?: boolean | undefined;
  /** 0-based index among the matches. */
  readonly nth?: number | undefined;
}

export function targetToChain(target: Target): SelectorChain {
  const chain: SelectorChain[number][] = [];
  if (target.testId !== undefined) chain.push({ kind: 'testId', value: target.testId });
  if (target.text !== undefined) {
    chain.push(
      target.exact
        ? { kind: 'text', value: target.text, exact: true }
        : { kind: 'text', value: target.text },
    );
  }
  if (target.nth !== undefined) chain.push({ kind: 'nth', index: target.nth });
  return chain;
}

/** The locator expression a test would use for `target`, e.g. `app.getByTestId('play')`. */
export function targetToCode(target: Target): string {
  let code = 'app';
  if (target.testId !== undefined) code += `.getByTestId(${quote(target.testId)})`;
  if (target.text !== undefined) {
    code += `.getByText(${quote(target.text)}${target.exact ? ', { exact: true }' : ''})`;
  }
  if (target.nth !== undefined) code += target.nth === 0 ? '.first()' : `.nth(${target.nth})`;
  return code;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
