import { ToetsError, packageDocsLink, type App, type Locator } from '@toets/core';

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

/** The core `Locator` a test would write for `target`; the tools act through it. */
export function locate(app: App, target: Target): Locator {
  const { testId, text, exact, nth } = target;
  const byTestId = testId === undefined ? null : app.getByTestId(testId);
  const scope: App | Locator = byTestId ?? app;
  const locator =
    text === undefined ? byTestId : scope.getByText(text, exact ? { exact: true } : undefined);
  if (!locator) {
    throw new ToetsError('MCP_BAD_INPUT', 'A target needs `testId` and/or `text`.', {
      hint: 'e.g. { "testId": "play_button" } or { "text": "Settings" }.',
      docs: packageDocsLink('mcp', 'tools'),
    });
  }
  if (nth === undefined) return locator;
  return nth === 0 ? locator.first() : locator.nth(nth);
}

/** The locator as test code, e.g. `app.getByTestId('rail').getByText('Movie', { exact: true })`. */
export function locatorCode(locator: Locator): string {
  return `app.${String(locator)}`;
}
