import { ToetsError } from '@toets/core';

const explained = new WeakSet<ToetsError>();

/**
 * Playwright prints an error as `name: message` plus stack frames, never `toString()`. This folds
 * a `ToetsError`'s code, hint and docs into what it prints, so the test output carries them:
 *
 * ```
 * ToetsError: [ELEMENT_NOT_FOUND] getByTestId('x') matched no element within 5000ms.
 * Hint: ...
 * Docs: reference/core/docs/locators (offline: node_modules/@toets/core/docs/locators.md)
 * ```
 *
 * Applied once per error, where errors leave toets for Playwright (action steps, worker start,
 * matchers). Anything else is returned unchanged. Do not call `toString()` on the error afterwards:
 * it would repeat the hint.
 */
export function explainForRunner(error: unknown): unknown {
  if (!(error instanceof ToetsError) || explained.has(error)) return error;
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
