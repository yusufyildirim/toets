import type { TestInfo } from '@playwright/test';

/**
 * Identity of the outermost serial group a test belongs to (`test.describe.serial` or
 * `test.describe.configure({ mode: 'serial' })`), or `null`. Tests of one serial group share
 * the app instance.
 *
 * Playwright marks every test inside a serial suite with a `serial` annotation carrying the
 * suite's location, outermost suite first; the group is identified by that location.
 */
export function serialGroupOf(testInfo: Pick<TestInfo, 'annotations' | 'file'>): string | null {
  const serial = testInfo.annotations.find((a) => a.type === 'serial');
  if (!serial) return null;
  const loc = serial.location;
  return loc ? `${loc.file}:${loc.line}:${loc.column}` : `${testInfo.file}:file`;
}
