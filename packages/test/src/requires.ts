import type { TestDetails, TestInfo } from '@playwright/test';
import { SDK_CAPABILITIES, type Capability } from '@dpad-tv/core';

/** Annotation type carrying a test's required capabilities. */
export const REQUIRES_ANNOTATION = 'requires';

/**
 * Declares capabilities a test (or a `describe` block) needs. On platforms without them the
 * test is skipped with the reason, and the parity matrix shows it.
 *
 * ```ts
 * test('color keys open the guide', requires('key.color'), async ({ app }) => { ... });
 * test('tagged', { ...requires('media.state'), tag: '@smoke' }, async ({ app }) => { ... });
 * ```
 *
 * Returned as Playwright test details (an annotation), so test locations, UI mode and
 * reporters keep working unchanged.
 */
export function requires(...capabilities: readonly Capability[]): TestDetails {
  return { annotation: { type: REQUIRES_ANNOTATION, description: capabilities.join(', ') } };
}

/** Capabilities required through `requires()` annotations (test and enclosing describes). */
export function requiredCapabilities(annotations: TestInfo['annotations']): Capability[] {
  const out = new Set<Capability>();
  for (const a of annotations) {
    if (a.type !== REQUIRES_ANNOTATION || !a.description) continue;
    for (const c of a.description.split(',')) if (c.trim()) out.add(c.trim() as Capability);
  }
  return [...out];
}

/**
 * Skip reason for missing capabilities, e.g. `requires key.color: not available on tvos`. When
 * the capability only needs a dpad option the project turned off, it says so:
 * `requires media.state: not available on web (dpad.sdk off)`.
 */
export function requiresSkipReason(
  missing: readonly Capability[],
  platform: string,
  enabled: { readonly sdk: boolean; readonly mock: boolean },
): string {
  const off: string[] = [];
  if (!enabled.sdk && missing.some((c) => SDK_CAPABILITIES.includes(c))) off.push('dpad.sdk');
  if (!enabled.mock && missing.includes('network.mock')) off.push('dpad.mock');
  const suffix = off.length ? ` (${off.join(', ')} off)` : '';
  return `requires ${missing.join(', ')}: not available on ${platform}${suffix}`;
}
