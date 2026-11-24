/**
 * Runs the tvOS suite (test/tvos) with real Playwright Test against the real tvOS driver and
 * its SwiftUI fixture app. Skipped unless a simulator is provided or managed mode is asked for:
 *
 *   TOETS_TVOS_UDID=<udid> pnpm --filter @toets/test test test/tvos.test.ts
 *   TOETS_TVOS_MANAGED=1 pnpm --filter @toets/test test test/tvos.test.ts
 *
 * The fixture is built on demand (`pnpm --filter @toets/driver-tvos build:fixture`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const enabled = !!process.env.TOETS_TVOS_UDID || process.env.TOETS_TVOS_MANAGED === '1';
const here = dirname(new URL(import.meta.url).pathname);
const fixtureDir = join(here, '..', '..', 'driver-tvos', 'fixtures', 'tvos-app');
const cli = join(
  dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
  'cli.js',
);

describe.skipIf(!enabled)('@toets/test on a tvOS simulator', () => {
  const out = mkdtempSync(join(tmpdir(), 'toets-tvos-pw-'));
  afterAll(() => {
    if (!process.env.TOETS_KEEP_ARTIFACTS) rmSync(out, { recursive: true, force: true });
  });

  it('runs the fixture suite through the real driver', { timeout: 1_200_000 }, () => {
    if (!existsSync(join(fixtureDir, 'build', 'ToetsFixture.app'))) {
      execFileSync(join(fixtureDir, 'build.sh'), { stdio: 'inherit' });
    }
    const run = spawnSync(
      process.execPath,
      [cli, 'test', '-c', join(here, 'tvos', 'playwright.config.ts')],
      {
        cwd: here,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '--conditions=@toets/source', TOETS_TVOS_OUT: out },
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
    expect(report.match(/"name": "toets-video"/g)).toHaveLength(3);
  });
});
