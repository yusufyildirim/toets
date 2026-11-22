/**
 * Runs the tvOS suite (test/tvos) with real Playwright Test against the real tvOS driver and
 * its SwiftUI fixture app. Skipped unless a simulator is provided or managed mode is asked for:
 *
 *   DPAD_TVOS_UDID=<udid> pnpm --filter @dpad-tv/test test test/tvos.test.ts
 *   DPAD_TVOS_MANAGED=1 pnpm --filter @dpad-tv/test test test/tvos.test.ts
 *
 * The fixture is built on demand (`pnpm --filter @dpad-tv/driver-tvos build:fixture`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = !!process.env.DPAD_TVOS_UDID || process.env.DPAD_TVOS_MANAGED === '1';
const here = dirname(new URL(import.meta.url).pathname);
const fixtureDir = join(here, '..', '..', 'driver-tvos', 'fixtures', 'tvos-app');
const cli = join(
  dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
  'cli.js',
);

describe.skipIf(!enabled)('@dpad-tv/test on a tvOS simulator', () => {
  const out = mkdtempSync(join(tmpdir(), 'dpad-tvos-pw-'));
  afterAll(() => {
    if (!process.env.DPAD_KEEP_ARTIFACTS) rmSync(out, { recursive: true, force: true });
  });

  it('runs the fixture suite through the real driver', { timeout: 1_200_000 }, () => {
    if (!existsSync(join(fixtureDir, 'build', 'DpadFixture.app'))) {
      execFileSync(join(fixtureDir, 'build.sh'), { stdio: 'inherit' });
    }
    const run = spawnSync(
      process.execPath,
      [cli, 'test', '-c', join(here, 'tvos', 'playwright.config.ts')],
      {
        cwd: here,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '--conditions=@dpad-tv/source', DPAD_TVOS_OUT: out },
        timeout: 1_150_000,
      },
    );
    const output = `${run.stdout}\n${run.stderr}`;
    console.log(output);
    expect(run.status, output).toBe(0);

    const parity = readFileSync(join(out, 'parity.md'), 'utf8');
    expect(parity).toContain('requires key.color: not available on tvos');
    const report = readFileSync(join(out, 'report.json'), 'utf8');
    const stats = (JSON.parse(report) as { stats: Record<string, number> }).stats;
    expect(stats).toMatchObject({ expected: 3, skipped: 1, unexpected: 0 });
    // `video: 'on'`: every test that ran attaches its screen recording.
    expect(report.match(/"name": "dpad-video"/g)).toHaveLength(3);
  });
});
