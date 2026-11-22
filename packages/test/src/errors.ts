import { DpadError } from '@dpad-tv/core';

const explained = new WeakSet<DpadError>();

/**
 * Playwright prints an error as `name: message` plus stack frames, never `toString()`. This folds
 * a `DpadError`'s code, hint and docs into what it prints, so the test output carries them:
 *
 * ```
 * DpadError: [ELEMENT_NOT_FOUND] getByTestId('x') matched no element within 5000ms.
 * Hint: ...
 * Docs: reference/core/docs/locators (offline: node_modules/@dpad-tv/core/docs/locators.md)
 * ```
 *
 * Applied once per error, where errors leave dpad for Playwright (action steps, worker start,
 * matchers). Anything else is returned unchanged. Do not call `toString()` on the error afterwards:
 * it would repeat the hint.
 */
export function explainForRunner(error: unknown): unknown {
  if (!(error instanceof DpadError) || explained.has(error)) return error;
  explained.add(error);
  const full = error.toString();
  error.message = `[${error.code}] ${full.slice(full.indexOf(': ') + 2)}`;
  return error;
}

/** Runs `fn`, passing any error through {@link explainForRunner}. */
export async function withExplainedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw explainForRunner(error);
  }
}
